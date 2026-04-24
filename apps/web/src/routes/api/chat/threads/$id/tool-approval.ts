import { Result, TaggedError } from 'better-result'
import { and, eq, inArray } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { schema } from '@/lib/server/db'
import { parseJsonBody, toolApprovalBodySchema } from '@/lib/server/api-validation'
import { json, notFound } from '@/lib/server/control-plane'
import { getThreadAccess } from '@/lib/server/chat-threads'

const textEncoder = new TextEncoder()

class ToolApprovalRouteError extends TaggedError('ToolApprovalRouteError')<{
  status: number
  message: string
}>() {}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeJson(entry))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalizeJson(entry)]),
    )
  }

  return value
}

function canonicalJsonString(value: unknown) {
  return JSON.stringify(canonicalizeJson(value ?? null))
}

async function hashToolArgs(value: unknown) {
  return Result.tryPromise({
    try: async () => {
      const digest = await crypto.subtle.digest(
        'SHA-256',
        textEncoder.encode(canonicalJsonString(value)),
      )
      return Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('')
    },
    catch: () =>
      new ToolApprovalRouteError({
        status: 500,
        message: 'Failed to hash denied tool call arguments',
      }),
  })
}

export const Route = createFileRoute('/api/chat/threads/$id/tool-approval')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const access = await getThreadAccess(request, params.id)
        if (access instanceof Response) return access

        const bodyResult = await parseJsonBody(
          request,
          toolApprovalBodySchema,
          'Invalid tool approval payload',
        )
        if (bodyResult.isErr()) {
          return json({ error: bodyResult.error.message }, 400)
        }

        const { approved, toolCallId } = bodyResult.value

        const referenceRequestResult = await Result.tryPromise({
          try: async () =>
            access.db
              .select({
                agentId: schema.permissionRequest.agentId,
                capabilityId: schema.permissionRequest.capabilityId,
                argsJson: schema.permissionRequest.argsJson,
              })
              .from(schema.permissionRequest)
              .innerJoin(
                schema.agent,
                eq(schema.agent.id, schema.permissionRequest.agentId),
              )
              .where(
                and(
                  eq(schema.permissionRequest.toolCallId, toolCallId),
                  eq(schema.permissionRequest.status, 'pending'),
                  eq(schema.agent.workspaceId, access.thread.workspaceId),
                ),
              )
              .limit(1),
          catch: () =>
            new ToolApprovalRouteError({
              status: 500,
              message: 'Failed to load permission request',
            }),
        })
        if (referenceRequestResult.isErr()) {
          return json(
            { error: referenceRequestResult.error.message },
            referenceRequestResult.error.status,
          )
        }

        const referenceRequest = referenceRequestResult.value[0]
        if (!referenceRequest) {
          return notFound('Permission request not found')
        }

        const pendingRequestsResult = await Result.tryPromise({
          try: async () =>
            access.db
              .select({
                id: schema.permissionRequest.id,
                toolCallId: schema.permissionRequest.toolCallId,
                argsJson: schema.permissionRequest.argsJson,
              })
              .from(schema.permissionRequest)
              .where(
                and(
                  eq(schema.permissionRequest.agentId, referenceRequest.agentId),
                  eq(
                    schema.permissionRequest.capabilityId,
                    referenceRequest.capabilityId,
                  ),
                  eq(schema.permissionRequest.status, 'pending'),
                ),
              ),
          catch: () =>
            new ToolApprovalRouteError({
              status: 500,
              message: 'Failed to load matching permission requests',
            }),
        })
        if (pendingRequestsResult.isErr()) {
          return json(
            { error: pendingRequestsResult.error.message },
            pendingRequestsResult.error.status,
          )
        }

        const referenceArgsSignature = canonicalJsonString(referenceRequest.argsJson)
        const matchingRequestIds = pendingRequestsResult.value
          .filter(
            (candidate) =>
              canonicalJsonString(candidate.argsJson) === referenceArgsSignature,
          )
          .map((candidate) => candidate.id)

        if (matchingRequestIds.length === 0) {
          return notFound('Permission request not found')
        }

        const resolvedAt = new Date()
        const updateResult = await Result.tryPromise({
          try: async () =>
            access.db
              .update(schema.permissionRequest)
              .set({
                status: approved ? 'approved' : 'denied',
                resolvedBy: access.session.user.id,
                resolvedAt,
              })
              .where(inArray(schema.permissionRequest.id, matchingRequestIds))
              .returning({
                agentId: schema.permissionRequest.agentId,
                capabilityId: schema.permissionRequest.capabilityId,
                toolCallId: schema.permissionRequest.toolCallId,
                argsJson: schema.permissionRequest.argsJson,
              }),
          catch: () =>
            new ToolApprovalRouteError({
              status: 500,
              message: 'Failed to resolve permission request',
            }),
        })
        if (updateResult.isErr()) {
          return json({ error: updateResult.error.message }, updateResult.error.status)
        }

        if (!approved && updateResult.value.length > 0) {
          const auditRows: Array<typeof schema.toolCallAudit.$inferInsert> = []
          for (const entry of updateResult.value) {
            const argsHashResult = await hashToolArgs(entry.argsJson)
            if (argsHashResult.isErr()) {
              return json(
                { error: argsHashResult.error.message },
                argsHashResult.error.status,
              )
            }

            auditRows.push({
              id: crypto.randomUUID(),
              workspaceId: access.thread.workspaceId,
              agentId: entry.agentId,
              capabilityId: entry.capabilityId,
              toolCallId: entry.toolCallId,
              argsHash: argsHashResult.value,
              resultStatus: 'denied' as const,
              durationMs: 0,
              error: 'User denied approval',
            })
          }

          const auditInsertResult = await Result.tryPromise({
            try: async () => {
              await access.db.insert(schema.toolCallAudit).values(auditRows)
            },
            catch: () =>
              new ToolApprovalRouteError({
                status: 500,
                message: 'Failed to write denial audit rows',
              }),
          })
          if (auditInsertResult.isErr()) {
            return json(
              { error: auditInsertResult.error.message },
              auditInsertResult.error.status,
            )
          }
        }

        return Response.json({
          ok: true,
          toolCallIds: updateResult.value.map((entry) => entry.toolCallId),
        })
      },
    },
  },
})
