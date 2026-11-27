import type { ChatActionContext, ChatRequestSource } from '@cloudflare/think'
import { Result } from 'better-result'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { GardenDatabase } from '@garden/db'
import * as schema from '@garden/db/schema'
import {
  browserChatPrincipalFromTags,
  browserChatPrincipalSchema,
  browserChatRefused,
  browserChatUnavailable,
  checkBrowserChatPrincipal,
  type BrowserChatAuthorityError,
  type BrowserChatPrincipal,
} from './browser-chat-authority'

const proposalSchema = z.strictObject({
  kind: z.literal('garden-approval'),
  permissionRequestId: z.uuid(),
  pendingAgentId: z.uuid(),
  approved: z.boolean(),
})
const handoffSchema = z.strictObject({
  kind: z.literal('browser-handoff'),
  principal: browserChatPrincipalSchema,
})
const programmaticProposalSchema = proposalSchema.extend({
  principal: browserChatPrincipalSchema,
})
const decideMetadataSchema = z.strictObject({
  gardenChat: z.strictObject({
    kind: z.literal('decide-result'),
    runId: z.uuid(),
    attempt: z.number().int().positive(),
    threadId: z.uuid(),
  }),
})

export type ChatRequestAuthority = {
  kind: 'authorized'
  workspaceId: string
  userId: string
  agentId: string
  threadId: string
  runtimeKey: string
}

/** Requires the exact resolved proposal row and its current actor and agent state. */
async function checkProposalDecision(
  db: GardenDatabase,
  principal: BrowserChatPrincipal,
  proposal: z.infer<typeof proposalSchema>,
): Promise<Result<ChatRequestAuthority, BrowserChatAuthorityError>> {
  const rows = await Result.tryPromise({
    try: () =>
      db
        .select({ id: schema.agentProposalRequest.id })
        .from(schema.agentProposalRequest)
        .innerJoin(
          schema.agent,
          eq(schema.agent.id, schema.agentProposalRequest.pendingAgentId),
        )
        .where(
          and(
            eq(schema.agentProposalRequest.id, proposal.permissionRequestId),
            eq(schema.agentProposalRequest.threadId, principal.threadId),
            eq(schema.agentProposalRequest.agentId, principal.agentId),
            eq(
              schema.agentProposalRequest.pendingAgentId,
              proposal.pendingAgentId,
            ),
            eq(schema.agentProposalRequest.resolvedBy, principal.userId),
            eq(
              schema.agentProposalRequest.status,
              proposal.approved ? 'approved' : 'denied',
            ),
            eq(schema.agent.workspaceId, principal.workspaceId),
            eq(schema.agent.status, proposal.approved ? 'active' : 'archived'),
          ),
        )
        .limit(2),
    catch: () => browserChatUnavailable(),
  })
  return Result.gen(async function* () {
    const values = yield* rows
    if (values.length !== 1) return Result.err(browserChatRefused())
    // A later decision lookup must not extend an earlier session observation.
    yield* Result.await(checkBrowserChatPrincipal(db, principal))
    return Result.ok({ kind: 'authorized' as const, ...principal })
  })
}

/** Reads current authority from a server-bound browser, handoff or exact Decide record. */
async function authorizeSource(
  db: GardenDatabase,
  runtimeKey: string,
  source: ChatRequestSource,
): Promise<Result<ChatRequestAuthority, BrowserChatAuthorityError>> {
  if (source.kind === 'unattributed') return Result.err(browserChatRefused())
  if (source.kind === 'submission') {
    const metadata = decideMetadataSchema.safeParse(source.metadata)
    if (!metadata.success) return Result.err(browserChatRefused())
    const input = metadata.data.gardenChat
    if (
      source.submissionId !==
      `decide-analysis:${input.runId}:attempt:${input.attempt}`
    )
      return Result.err(browserChatRefused())
    const rows = await Result.tryPromise({
      try: () =>
        db
          .select({
            workspaceId: schema.chatThread.workspaceId,
            userId: schema.chatThread.ownerUserId,
            agentId: schema.chatThread.agentId,
            threadId: schema.chatThread.id,
            runtimeKey: schema.chatThread.runtimeKey,
          })
          .from(schema.decideAnalysisRun)
          .innerJoin(
            schema.chatThread,
            eq(schema.chatThread.id, schema.decideAnalysisRun.threadId),
          )
          .innerJoin(
            schema.agent,
            eq(schema.agent.id, schema.chatThread.agentId),
          )
          .innerJoin(
            schema.member,
            and(
              eq(schema.member.userId, schema.chatThread.ownerUserId),
              eq(schema.member.organizationId, schema.chatThread.workspaceId),
            ),
          )
          .where(
            and(
              eq(schema.decideAnalysisRun.id, input.runId),
              eq(schema.decideAnalysisRun.attempt, input.attempt),
              eq(schema.decideAnalysisRun.ownerKind, 'chat'),
              eq(schema.decideAnalysisRun.threadId, input.threadId),
              eq(
                schema.decideAnalysisRun.workspaceId,
                schema.chatThread.workspaceId,
              ),
              eq(
                schema.decideAnalysisRun.ownerUserId,
                schema.chatThread.ownerUserId,
              ),
              eq(schema.decideAnalysisRun.agentId, schema.chatThread.agentId),
              inArray(schema.decideAnalysisRun.status, ['completed', 'failed']),
              eq(schema.chatThread.runtimeKey, runtimeKey),
              eq(schema.chatThread.runtimeKind, 'chat'),
              isNull(schema.chatThread.archivedAt),
              eq(schema.agent.workspaceId, schema.chatThread.workspaceId),
              eq(schema.agent.status, 'active'),
            ),
          )
          .limit(2),
      catch: () => browserChatUnavailable(),
    })
    return rows.andThen((values) =>
      values.length === 1 && values[0]
        ? Result.ok({ kind: 'authorized' as const, ...values[0] })
        : Result.err(browserChatRefused()),
    )
  }

  return Result.gen(async function* () {
    const principal =
      source.kind === 'connection'
        ? yield* browserChatPrincipalFromTags(source.connectionTags)
        : yield* (() => {
            const data = handoffSchema.safeParse(source.applicationContext)
            const proposal = programmaticProposalSchema.safeParse(
              source.applicationContext,
            )
            return data.success
              ? Result.ok(data.data.principal)
              : proposal.success
                ? Result.ok(proposal.data.principal)
                : Result.err(browserChatRefused())
          })()
    if (principal.runtimeKey !== runtimeKey)
      return Result.err(browserChatRefused())
    yield* Result.await(checkBrowserChatPrincipal(db, principal))
    const applicationContext = source.applicationContext
    if (source.kind === 'connection' && applicationContext === undefined)
      return Result.ok({ kind: 'authorized' as const, ...principal })
    const proposal =
      source.kind === 'connection'
        ? proposalSchema.safeParse(applicationContext)
        : programmaticProposalSchema.safeParse(applicationContext)
    if (proposal.success)
      return await checkProposalDecision(db, principal, proposal.data)
    if (
      source.kind === 'programmatic' &&
      handoffSchema.safeParse(applicationContext).success
    )
      return Result.ok({ kind: 'authorized' as const, ...principal })
    return Result.err(browserChatRefused())
  })
}

// One Executor call can name several connectors, and each one records a row.
const maxToolDecisionRows = 16

/**
 * Matches every permission row of the pending tool to the exact SDK decision.
 * The resolve routes own who may decide: the thread owner, a workspace
 * approver or the Team owner. This check requires their recorded decision and
 * that the resolver is still a member of the thread's workspace.
 */
async function checkToolDecision(
  db: GardenDatabase,
  authority: ChatRequestAuthority,
  action: ChatActionContext,
): Promise<Result<void, BrowserChatAuthorityError>> {
  const expected =
    action.action === 'apply-tool-approval'
      ? action.approved
      : action.approval?.approved
  const toolCallId = action.toolCallId
  if (!toolCallId) return Result.err(browserChatRefused())
  const result = await Result.tryPromise({
    try: () =>
      db
        .select({
          status: schema.permissionRequest.status,
          threadId: schema.permissionRequest.threadId,
          agentId: schema.permissionRequest.agentId,
          live: sql<boolean>`${schema.permissionRequest.expiresAt} is null or ${schema.permissionRequest.expiresAt} > clock_timestamp()`,
          resolverIsMember: sql<boolean>`exists (
            select 1 from ${schema.member}
            where ${schema.member.userId} = ${schema.permissionRequest.resolvedBy}
              and ${schema.member.organizationId} = ${authority.workspaceId}
          )`,
        })
        .from(schema.permissionRequest)
        .where(
          and(
            eq(schema.permissionRequest.toolCallId, toolCallId),
            eq(schema.permissionRequest.kind, 'connector_write'),
          ),
        )
        .limit(maxToolDecisionRows + 1),
    catch: () => browserChatUnavailable(),
  })
  return result.andThen((rows) => {
    if (rows.length === 0 && expected === undefined) return Result.ok(undefined)
    const inScope = rows.every(
      (row) =>
        row.threadId === authority.threadId &&
        row.agentId === authority.agentId,
    )
    const decided = (status: 'approved' | 'denied') =>
      rows.filter(
        (row) => row.status === status && row.live && row.resolverIsMember,
      ).length
    if (
      rows.length === 0 ||
      rows.length > maxToolDecisionRows ||
      expected === undefined ||
      !inScope
    )
      return Result.err(browserChatRefused())
    // An effect needs every row approved. One recorded denial settles a refusal.
    if (expected && decided('approved') === rows.length)
      return Result.ok(undefined)
    if (
      !expected &&
      action.action === 'apply-tool-approval' &&
      decided('denied') > 0
    )
      return Result.ok(undefined)
    return Result.err(browserChatRefused())
  })
}

/** Reads current authority for the exact request, its lineage and its decision. */
export async function authorizeChatRequestAction(
  db: GardenDatabase,
  runtimeKey: string,
  action: ChatActionContext,
): Promise<Result<ChatRequestAuthority, BrowserChatAuthorityError>> {
  if (
    action.action === 'unsupported-model' ||
    action.action === 'approve-execution' ||
    action.action === 'reject-execution'
  )
    // No Garden decision currently maps an SDK execution ID to its exact grant.
    return Result.err(browserChatRefused())
  return Result.gen(async function* () {
    const authority = yield* Result.await(
      authorizeSource(db, runtimeKey, action.request.source),
    )
    const sources = [
      ...(action.request.initiatingSources ?? []),
      ...(action.initiatingRequest
        ? [
            action.initiatingRequest.source,
            ...(action.initiatingRequest.initiatingSources ?? []),
          ]
        : []),
      ...(action.approval
        ? [
            action.approval.request.source,
            ...(action.approval.request.initiatingSources ?? []),
          ]
        : []),
    ]
    for (const source of sources) {
      const original = yield* Result.await(
        authorizeSource(db, runtimeKey, source),
      )
      if (
        original.threadId !== authority.threadId ||
        original.workspaceId !== authority.workspaceId ||
        original.userId !== authority.userId ||
        original.agentId !== authority.agentId
      )
        return Result.err(browserChatRefused())
    }
    if (
      action.action === 'execute-tool' ||
      action.action === 'dispatch-client-tool' ||
      action.action === 'apply-tool-approval'
    )
      yield* Result.await(checkToolDecision(db, authority, action))
    // Recheck the current source after all additional database reads and waits.
    yield* Result.await(authorizeSource(db, runtimeKey, action.request.source))
    return Result.ok(authority)
  })
}
