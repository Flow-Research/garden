import { Result, TaggedError } from 'better-result'
import { and, eq } from 'drizzle-orm'
import {
  AgentPermissionsSchema,
  derivePermissions,
  type AgentPermissions,
} from '@garden/core/agents/permissions'
import { getPooledDb } from '@garden/db/runtime'
import * as schema from '@garden/db/schema'
import type { BrainToolContext } from './agent-tools/brain'

export type BrainRunOrigin = {
  runKind: 'issue' | 'automation'
  runId: string
  workspaceId: string
  agentId: string
  ownerUserId: string | null
  runtimeName: string
  objectId: string
}

export class BrainRunAuthorityError extends TaggedError(
  'BrainRunAuthorityError',
)<{
  message: string
  cause?: unknown
}>() {}

/** Uses the existing issue/automation empty-list semantics, never chat defaults. */
export function isBrainRunToolAllowed(
  permissions: AgentPermissions,
  toolName: string,
): boolean {
  return (
    permissions.full_access ||
    permissions.allowed_tools.length === 0 ||
    permissions.allowed_tools.includes(toolName)
  )
}

/** Resolves the trusted SDK parent name; UUID ids take precedence over aliases. */
export async function resolveBrainRuntimeAgentId(
  databaseUrl: string,
  runtimeName: string,
) {
  const db = getPooledDb(databaseUrl)
  return (
    await Result.tryPromise({
      try: async () => {
        if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(runtimeName)) {
          const [direct] = await db
            .select({ id: schema.agent.id })
            .from(schema.agent)
            .where(eq(schema.agent.id, runtimeName))
            .limit(1)
          if (direct) return [direct]
        }
        return await db
          .select({ id: schema.agent.id })
          .from(schema.agent)
          .where(eq(schema.agent.hostName, runtimeName))
          .limit(2)
      },
      catch: (cause) =>
        new BrainRunAuthorityError({
          message: 'Cannot resolve Brain runtime principal.',
          cause,
        }),
    })
  ).andThen((rows) =>
    rows.length === 1
      ? Result.ok(rows[0]!.id)
      : Result.err(
          new BrainRunAuthorityError({
            message: 'Brain runtime principal is missing or ambiguous.',
          }),
        ),
  )
}

/**
 * Resolves exact originating ledger identity and fresh grants before a Brain
 * operation. Workspace-only checks previously let completion run under an
 * unrelated agent. Missing/malformed persisted policy fails closed before
 * derivePermissions can apply its permissive input fallback.
 */
export async function loadBrainRunAuthority(
  databaseUrl: string,
  origin: BrainRunOrigin,
) {
  if (!origin.runtimeName || !origin.objectId)
    return Result.err(
      new BrainRunAuthorityError({
        message: 'Brain runtime principal is unavailable.',
      }),
    )
  const db = getPooledDb(databaseUrl)
  const principalResult = await resolveBrainRuntimeAgentId(
    databaseUrl,
    origin.runtimeName,
  )
  if (principalResult.isErr()) return Result.err(principalResult.error)
  if (principalResult.value !== origin.agentId)
    return Result.err(
      new BrainRunAuthorityError({
        message: 'Brain run does not belong to this runtime principal.',
      }),
    )
  const principal = eq(schema.agent.id, principalResult.value)
  const loaded = await Result.tryPromise({
    try: async () => {
      const columns = {
        permissions: schema.agent.permissions,
        ownerUserId: schema.agent.ownerUserId,
      }
      if (origin.runKind === 'issue') {
        const [row] = await db
          .select({
            ...columns,
            permissionsOverride: schema.issue.permissionsOverride,
          })
          .from(schema.issueRun)
          .innerJoin(schema.agent, eq(schema.agent.id, schema.issueRun.agentId))
          .innerJoin(schema.issue, eq(schema.issue.id, schema.issueRun.issueId))
          .where(
            and(
              principal,
              eq(schema.issue.id, origin.objectId),
              eq(schema.issueRun.id, origin.runId),
              eq(schema.issueRun.agentId, origin.agentId),
              eq(schema.issueRun.workspaceId, origin.workspaceId),
              eq(schema.agent.workspaceId, origin.workspaceId),
              eq(schema.issue.workspaceId, origin.workspaceId),
            ),
          )
          .limit(1)
        return row
      }
      const [row] = await db
        .select(columns)
        .from(schema.automationRun)
        .innerJoin(
          schema.agent,
          eq(schema.agent.id, schema.automationRun.agentId),
        )
        .innerJoin(
          schema.automation,
          eq(schema.automation.id, schema.automationRun.automationId),
        )
        .where(
          and(
            principal,
            eq(schema.automationRun.id, origin.objectId),
            eq(schema.automationRun.id, origin.runId),
            eq(schema.automationRun.agentId, origin.agentId),
            eq(schema.automationRun.workspaceId, origin.workspaceId),
            eq(schema.agent.workspaceId, origin.workspaceId),
            eq(schema.automation.workspaceId, origin.workspaceId),
          ),
        )
        .limit(1)
      return row ? { ...row, permissionsOverride: null } : undefined
    },
    catch: (cause) =>
      new BrainRunAuthorityError({
        message: 'Brain run authority could not be loaded.',
        cause,
      }),
  })
  return loaded.andThen((row) => {
    if (
      !row ||
      row.ownerUserId !== origin.ownerUserId ||
      row.permissions == null ||
      !AgentPermissionsSchema.safeParse(row.permissions).success ||
      (row.permissionsOverride != null &&
        !AgentPermissionsSchema.safeParse(row.permissionsOverride).success)
    ) {
      return Result.err(
        new BrainRunAuthorityError({
          message: 'Brain run authority is unavailable.',
        }),
      )
    }
    return Result.ok({
      permissions: derivePermissions({
        agent: row,
        issue: origin.runKind === 'issue' ? row : null,
      }),
      context: {
        workspaceId: origin.workspaceId,
        agentId: origin.agentId,
        runId: origin.runId,
        userId: row.ownerUserId,
        ...(origin.runKind === 'issue' ? { readAudience: 'org' as const } : {}),
      } satisfies BrainToolContext,
    })
  })
}

/** Fresh denial stops the operation before retrieval, including internal dedupe. */
export async function authorizeBrainRunTool(
  databaseUrl: string,
  origin: BrainRunOrigin,
  toolName: string,
) {
  return (await loadBrainRunAuthority(databaseUrl, origin)).andThen(
    (authority) =>
      isBrainRunToolAllowed(authority.permissions, toolName)
        ? Result.ok(authority.context)
        : Result.err(
            new BrainRunAuthorityError({
              message: `Brain operation ${toolName} is not permitted.`,
            }),
          ),
  )
}

const brainExposureTools = [
  'brain_search',
  'brain_neighborhood',
  'add_to_brain',
  'brain_observe_mention',
  'brain_link',
] as const

/**
 * Records required grants before Brain information may enter durable history.
 * Each resumed submission revalidates every recorded grant; unknown old history
 * requires a restart because current grants cannot prove its audience. Brain-free history remains
 * usable without them. This never edits retained messages or uses hydration.
 */
export async function ensureBrainRunHistory(input: {
  identity: string
  permissions: AgentPermissions
  exposeTool?: string
  marker: unknown
  readDurableHistory: () => Promise<readonly unknown[]>
  persist: (marker: { identity: string; tools: string[] }) => void
}) {
  const marker = input.marker
  const valid =
    marker !== null &&
    typeof marker === 'object' &&
    'identity' in marker &&
    marker.identity === input.identity &&
    'tools' in marker &&
    Array.isArray(marker.tools) &&
    marker.tools.every(
      (tool) =>
        typeof tool === 'string' &&
        brainExposureTools.includes(
          tool as (typeof brainExposureTools)[number],
        ),
    )
  if (marker !== undefined && !valid)
    return Result.err(
      new BrainRunAuthorityError({
        message:
          'Retained Brain provenance is invalid or belongs to another principal. Start a new run.',
      }),
    )
  let tools: string[]
  if (valid) {
    tools = [...(marker.tools as string[])]
  } else {
    const history = await Result.tryPromise({
      try: input.readDurableHistory,
      catch: (cause) =>
        new BrainRunAuthorityError({
          message: 'Cannot verify retained Brain access.',
          cause,
        }),
    })
    if (history.isErr()) return Result.err(history.error)
    if (history.value.length > 0)
      return Result.err(
        new BrainRunAuthorityError({
          message:
            'Retained Brain history has no verified provenance. Start a new run with reviewed context.',
        }),
      )
    tools = []
  }
  if (input.exposeTool !== undefined)
    tools = [...new Set([...tools, input.exposeTool])]
  if (tools.some((tool) => !isBrainRunToolAllowed(input.permissions, tool)))
    return Result.err(
      new BrainRunAuthorityError({
        message:
          'Retained history may contain Brain context whose grant is unavailable. Start a new run with reviewed context.',
      }),
    )
  return Result.try({
    try: () => input.persist({ identity: input.identity, tools }),
    catch: (cause) =>
      new BrainRunAuthorityError({
        message: 'Cannot persist Brain access provenance.',
        cause,
      }),
  })
}

/** Binds entry RPCs before cancellation/failure handlers can mutate a run ledger. */
export async function verifyBrainRunBinding(
  databaseUrl: string,
  input: Pick<BrainRunOrigin, 'runId' | 'runKind' | 'runtimeName' | 'objectId'>,
) {
  const db = getPooledDb(databaseUrl)
  const table =
    input.runKind === 'issue' ? schema.issueRun : schema.automationRun
  const loaded = await Result.tryPromise({
    try: async () => {
      const [row] = await db
        .select({
          workspaceId: table.workspaceId,
          agentId: table.agentId,
          ownerUserId: schema.agent.ownerUserId,
        })
        .from(table)
        .innerJoin(schema.agent, eq(schema.agent.id, table.agentId))
        .where(eq(table.id, input.runId))
        .limit(1)
      return row
    },
    catch: (cause) =>
      new BrainRunAuthorityError({
        message: 'Cannot verify Brain run binding.',
        cause,
      }),
  })
  return await loaded.andThenAsync(async (row) =>
    row
      ? loadBrainRunAuthority(databaseUrl, { ...input, ...row })
      : Result.err(
          new BrainRunAuthorityError({
            message: 'Brain run binding is unavailable.',
          }),
        ),
  )
}
