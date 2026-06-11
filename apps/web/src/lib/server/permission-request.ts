import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { canonicalJsonString } from '@garden/connectors/capabilities'
import { schema, type Db } from './db'

type ServerDb = Db

type PermissionRequestRow = {
  id: string
  agentId: string
  capabilityId: string | null
  argsJson: unknown
  issueId: string | null
  toolCallId: string
}

type ConnectorWritePermissionRequestRow = PermissionRequestRow & {
  capabilityId: string
}

export class PermissionRequestServiceError extends TaggedError(
  'PermissionRequestServiceError',
)<{
  code: 'database_failed' | 'hash_failed' | 'permission_request_not_found'
  status: number
  message: string
  cause?: unknown
}>() {}

export type ResolveConnectorWritePermissionInput = {
  approved: boolean
  actorUserId: string
  db: ServerDb
  issueId?: string
  permissionRequestId?: string
  toolCallId?: string
  workspaceId: string
}

export type ResolveConnectorWritePermissionOutcome = {
  permissionRequestIds: string[]
  retryToolCalls: Array<{
    argsJson: unknown
    capabilityId: string
    toolCallId: string
  }>
  toolCallIds: string[]
}

async function hashToolArgs(value: unknown) {
  return Result.tryPromise({
    try: async () => {
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(canonicalJsonString(value)),
      )
      return Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('')
    },
    catch: (cause) =>
      new PermissionRequestServiceError({
        code: 'hash_failed',
        status: 500,
        message: 'Failed to hash denied tool call arguments',
        cause,
      }),
  })
}

async function loadReferenceRequest(
  input: ResolveConnectorWritePermissionInput,
): Promise<
  ResultValue<ConnectorWritePermissionRequestRow, PermissionRequestServiceError>
> {
  if (!input.toolCallId && !input.permissionRequestId) {
    return Result.err(
      new PermissionRequestServiceError({
        code: 'permission_request_not_found',
        status: 400,
        message: 'Permission request identifier is required',
      }),
    )
  }

  const requestFilter = input.permissionRequestId
    ? eq(schema.permissionRequest.id, input.permissionRequestId)
    : eq(schema.permissionRequest.toolCallId, input.toolCallId ?? '')
  const issueFilter = input.issueId
    ? eq(schema.permissionRequest.issueId, input.issueId)
    : undefined

  const requestResult = await Result.tryPromise({
    try: async () =>
      input.db
        .select({
          id: schema.permissionRequest.id,
          agentId: schema.permissionRequest.agentId,
          capabilityId: schema.permissionRequest.capabilityId,
          argsJson: schema.permissionRequest.argsJson,
          issueId: schema.permissionRequest.issueId,
          toolCallId: schema.permissionRequest.toolCallId,
        })
        .from(schema.permissionRequest)
        .innerJoin(
          schema.agent,
          eq(schema.agent.id, schema.permissionRequest.agentId),
        )
        .where(
          and(
            requestFilter,
            eq(schema.permissionRequest.kind, 'connector_write'),
            isNotNull(schema.permissionRequest.capabilityId),
            eq(schema.permissionRequest.status, 'pending'),
            eq(schema.agent.workspaceId, input.workspaceId),
            issueFilter,
          ),
        )
        .limit(1),
    catch: (cause) =>
      new PermissionRequestServiceError({
        code: 'database_failed',
        status: 500,
        message: 'Failed to load permission request',
        cause,
      }),
  })
  if (requestResult.isErr()) return Result.err(requestResult.error)

  const request = requestResult.value[0]
  if (request?.capabilityId) {
    return Result.ok({
      ...request,
      capabilityId: request.capabilityId,
    })
  }

  return Result.err(
    new PermissionRequestServiceError({
      code: 'permission_request_not_found',
      status: 404,
      message: 'Permission request not found',
    }),
  )
}

async function loadMatchingPendingRequests(args: {
  db: ServerDb
  referenceRequest: ConnectorWritePermissionRequestRow
}) {
  const issueScope = args.referenceRequest.issueId
    ? eq(schema.permissionRequest.issueId, args.referenceRequest.issueId)
    : isNull(schema.permissionRequest.issueId)

  const requestsResult = await Result.tryPromise({
    try: async () =>
      args.db
        .select({
          id: schema.permissionRequest.id,
          agentId: schema.permissionRequest.agentId,
          capabilityId: schema.permissionRequest.capabilityId,
          argsJson: schema.permissionRequest.argsJson,
          toolCallId: schema.permissionRequest.toolCallId,
        })
        .from(schema.permissionRequest)
        .where(
          and(
            eq(schema.permissionRequest.agentId, args.referenceRequest.agentId),
            eq(
              schema.permissionRequest.capabilityId,
              args.referenceRequest.capabilityId,
            ),
            eq(schema.permissionRequest.kind, 'connector_write'),
            isNotNull(schema.permissionRequest.capabilityId),
            eq(schema.permissionRequest.status, 'pending'),
            issueScope,
          ),
        ),
    catch: (cause) =>
      new PermissionRequestServiceError({
        code: 'database_failed',
        status: 500,
        message: 'Failed to load matching permission requests',
        cause,
      }),
  })
  if (requestsResult.isErr()) return Result.err(requestsResult.error)

  const referenceArgsSignature = canonicalJsonString(
    args.referenceRequest.argsJson,
  )
  const matchingRequests = requestsResult.value.flatMap((candidate) =>
    candidate.capabilityId &&
    canonicalJsonString(candidate.argsJson) === referenceArgsSignature
      ? [
          {
            ...candidate,
            capabilityId: candidate.capabilityId,
          },
        ]
      : [],
  )

  return matchingRequests.length > 0
    ? Result.ok(matchingRequests)
    : Result.err(
        new PermissionRequestServiceError({
          code: 'permission_request_not_found',
          status: 404,
          message: 'Permission request not found',
        }),
      )
}

async function writeDenialAuditRows(args: {
  db: ServerDb
  requests: Array<{
    agentId: string
    argsJson: unknown
    capabilityId: string
    toolCallId: string
  }>
  workspaceId: string
}) {
  const auditRows: Array<typeof schema.toolCallAudit.$inferInsert> = []
  for (const request of args.requests) {
    const argsHashResult = await hashToolArgs(request.argsJson)
    if (argsHashResult.isErr()) return Result.err(argsHashResult.error)

    auditRows.push({
      id: crypto.randomUUID(),
      workspaceId: args.workspaceId,
      agentId: request.agentId,
      capabilityId: request.capabilityId,
      toolCallId: request.toolCallId,
      argsHash: argsHashResult.value,
      resultStatus: 'denied',
      durationMs: 0,
      error: 'User denied approval',
    })
  }

  if (auditRows.length === 0) return Result.ok(undefined)

  return Result.tryPromise({
    try: async () => {
      await args.db.insert(schema.toolCallAudit).values(auditRows)
    },
    catch: (cause) =>
      new PermissionRequestServiceError({
        code: 'database_failed',
        status: 500,
        message: 'Failed to write denial audit rows',
        cause,
      }),
  })
}

export async function resolveConnectorWritePermissionRequests(
  input: ResolveConnectorWritePermissionInput,
): Promise<
  ResultValue<
    ResolveConnectorWritePermissionOutcome,
    PermissionRequestServiceError
  >
> {
  const referenceRequestResult = await loadReferenceRequest(input)
  if (referenceRequestResult.isErr()) return Result.err(referenceRequestResult.error)

  const matchingRequestsResult = await loadMatchingPendingRequests({
    db: input.db,
    referenceRequest: referenceRequestResult.value,
  })
  if (matchingRequestsResult.isErr()) return Result.err(matchingRequestsResult.error)

  const matchingRequests = matchingRequestsResult.value
  const matchingRequestIds = matchingRequests.map((request) => request.id)
  const resolvedAt = new Date()
  const updateResult = await Result.tryPromise({
    try: async () =>
      input.db
        .update(schema.permissionRequest)
        .set({
          status: input.approved ? 'approved' : 'denied',
          resolvedBy: input.actorUserId,
          resolvedAt,
        })
        .where(inArray(schema.permissionRequest.id, matchingRequestIds))
        .returning({
          argsJson: schema.permissionRequest.argsJson,
          capabilityId: schema.permissionRequest.capabilityId,
          toolCallId: schema.permissionRequest.toolCallId,
        }),
    catch: (cause) =>
      new PermissionRequestServiceError({
        code: 'database_failed',
        status: 500,
        message: 'Failed to resolve permission request',
        cause,
      }),
  })
  if (updateResult.isErr()) return Result.err(updateResult.error)

  if (!input.approved) {
    const auditResult = await writeDenialAuditRows({
      db: input.db,
      requests: matchingRequests,
      workspaceId: input.workspaceId,
    })
    if (auditResult.isErr()) return Result.err(auditResult.error)
  }

  const retryToolCalls = updateResult.value.flatMap((request) =>
    request.capabilityId
      ? [
          {
            argsJson: request.argsJson,
            capabilityId: request.capabilityId,
            toolCallId: request.toolCallId,
          },
        ]
      : [],
  )

  return Result.ok({
    permissionRequestIds: matchingRequestIds,
    retryToolCalls,
    toolCallIds: updateResult.value.map((request) => request.toolCallId),
  })
}
