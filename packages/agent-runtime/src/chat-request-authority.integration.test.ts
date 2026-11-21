import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import type { ChatActionContext, ChatRequestContext } from '@cloudflare/think'
import { startTestDb, type TestDb } from '@garden/db/testing'
import * as schema from '@garden/db/schema'
import {
  browserChatTags,
  type BrowserChatPrincipal,
} from './browser-chat-authority'
import { authorizeChatRequestAction } from './chat-request-authority'

let database: TestDb
beforeAll(async () => {
  database = await startTestDb()
}, 120_000)
afterAll(async () => {
  await database?.cleanup()
})

async function fixture() {
  const principal: BrowserChatPrincipal = {
    sessionId: randomUUID(),
    userId: randomUUID(),
    workspaceId: randomUUID(),
    agentId: randomUUID(),
    threadId: randomUUID(),
    runtimeKey: randomUUID(),
    runtimeName: randomUUID(),
  }
  await database.db.insert(schema.user).values({
    id: principal.userId,
    email: `${principal.userId}@example.test`,
  })
  await database.db.insert(schema.organization).values({
    id: principal.workspaceId,
    name: 'Request authority test',
    slug: principal.workspaceId,
  })
  await database.db.insert(schema.member).values({
    userId: principal.userId,
    organizationId: principal.workspaceId,
    role: 'owner',
  })
  await database.db.insert(schema.agent).values({
    id: principal.agentId,
    workspaceId: principal.workspaceId,
    ownerUserId: principal.userId,
    name: 'Request authority agent',
    hostName: principal.runtimeName,
  })
  await database.db.insert(schema.chatThread).values({
    title: 'Request authority chat',
    id: principal.threadId,
    runtimeKey: principal.runtimeKey,
    workspaceId: principal.workspaceId,
    agentId: principal.agentId,
    ownerUserId: principal.userId,
  })
  await database.db.insert(schema.session).values({
    id: principal.sessionId,
    token: randomUUID(),
    userId: principal.userId,
    expiresAt: new Date(Date.now() + 60_000),
    activeOrganizationId: principal.workspaceId,
  })
  const rootId = randomUUID()
  const request: ChatRequestContext = {
    version: 1,
    requestId: rootId,
    rootRequestId: rootId,
    source: {
      kind: 'connection',
      connectionId: randomUUID(),
      connectionTags: browserChatTags(principal),
    },
  }
  const admit = (changes: Partial<ChatActionContext> = {}) =>
    authorizeChatRequestAction(database.db, principal.runtimeKey, {
      action: 'model-call',
      request,
      ...changes,
    })
  return { principal, request, admit }
}

describe('chat request authority against actual PostgreSQL', () => {
  it('authorizes the current exact browser scope and refuses another runtime', async () => {
    const actor = await fixture()
    expect((await actor.admit()).isOk()).toBe(true)
    expect(
      (
        await authorizeChatRequestAction(database.db, randomUUID(), {
          action: 'model-call',
          request: actor.request,
        })
      ).isErr(),
    ).toBe(true)
  })

  it.each(['session', 'expiry', 'membership', 'agent', 'thread'] as const)(
    'refuses current %s revocation for model and tool actions',
    async (change) => {
      const actor = await fixture()
      if (change === 'session')
        await database.db
          .delete(schema.session)
          .where(eq(schema.session.id, actor.principal.sessionId))
      if (change === 'expiry')
        await database.db
          .update(schema.session)
          .set({ expiresAt: new Date(0) })
          .where(eq(schema.session.id, actor.principal.sessionId))
      if (change === 'membership')
        await database.db
          .delete(schema.member)
          .where(
            and(
              eq(schema.member.userId, actor.principal.userId),
              eq(schema.member.organizationId, actor.principal.workspaceId),
            ),
          )
      if (change === 'agent')
        await database.db
          .update(schema.agent)
          .set({ status: 'archived' })
          .where(eq(schema.agent.id, actor.principal.agentId))
      if (change === 'thread')
        await database.db
          .update(schema.chatThread)
          .set({ archivedAt: new Date() })
          .where(eq(schema.chatThread.id, actor.principal.threadId))
      expect((await actor.admit()).isErr()).toBe(true)
      expect(
        (
          await actor.admit({ action: 'execute-tool', toolCallId: 'unstarted' })
        ).isErr(),
      ).toBe(true)
    },
  )

  it('keeps a new request independent of an expired old session, while refusing its old pending continuation', async () => {
    const actor = await fixture()
    const newSession = randomUUID()
    await database.db.insert(schema.session).values({
      id: newSession,
      token: randomUUID(),
      userId: actor.principal.userId,
      expiresAt: new Date(Date.now() + 60_000),
    })
    const freshPrincipal = { ...actor.principal, sessionId: newSession }
    const requestId = randomUUID()
    const fresh: ChatRequestContext = {
      version: 1,
      requestId,
      rootRequestId: requestId,
      source: {
        kind: 'connection',
        connectionId: randomUUID(),
        connectionTags: browserChatTags(freshPrincipal),
      },
    }
    await database.db
      .delete(schema.session)
      .where(eq(schema.session.id, actor.principal.sessionId))
    expect((await actor.admit({ request: fresh })).isOk()).toBe(true)
    expect(
      (
        await actor.admit({
          request: {
            ...fresh,
            rootRequestId: actor.request.rootRequestId,
            initiatingSources: [actor.request.source],
          },
        })
      ).isErr(),
    ).toBe(true)
  })

  it('refuses unrelated browser lineage rather than borrowing its valid session', async () => {
    const first = await fixture()
    const other = await fixture()
    expect(
      (await first.admit({ initiatingRequest: other.request })).isErr(),
    ).toBe(true)
  })

  it('refuses unattributed sources and unsupported execution approvals', async () => {
    const actor = await fixture()
    expect(
      (
        await actor.admit({
          request: { ...actor.request, source: { kind: 'unattributed' } },
        })
      ).isErr(),
    ).toBe(true)
    expect(
      (
        await actor.admit({
          action: 'approve-execution',
          executionId: randomUUID(),
        })
      ).isErr(),
    ).toBe(true)
    expect(
      (
        await actor.admit({
          action: 'reject-execution',
          executionId: randomUUID(),
        })
      ).isErr(),
    ).toBe(true)
    expect((await actor.admit({ action: 'unsupported-model' })).isErr()).toBe(
      true,
    )
  })

  it('requires the actual current proposal decision instead of a client Boolean', async () => {
    const actor = await fixture()
    const pendingAgentId = randomUUID()
    const permissionRequestId = randomUUID()
    await database.db.insert(schema.agent).values({
      id: pendingAgentId,
      workspaceId: actor.principal.workspaceId,
      ownerUserId: actor.principal.userId,
      name: 'Proposed agent',
      status: 'active',
    })
    await database.db.insert(schema.agentProposalRequest).values({
      id: permissionRequestId,
      agentId: actor.principal.agentId,
      pendingAgentId,
      threadId: actor.principal.threadId,
      status: 'approved',
      resolvedBy: actor.principal.userId,
      resolvedAt: new Date(),
    })
    const source = actor.request.source
    if (source.kind !== 'connection')
      throw new Error('Expected a connection source')
    const request: ChatRequestContext = {
      ...actor.request,
      source: {
        ...source,
        applicationContext: {
          kind: 'garden-approval',
          permissionRequestId,
          pendingAgentId,
          approved: true,
        },
      },
    }
    expect((await actor.admit({ request })).isOk()).toBe(true)
    await database.db
      .update(schema.agentProposalRequest)
      .set({ status: 'denied' })
      .where(eq(schema.agentProposalRequest.id, permissionRequestId))
    expect((await actor.admit({ request })).isErr()).toBe(true)
  })

  it('matches tool approvals by exact thread, actor, outcome and retained SDK decision', async () => {
    const actor = await fixture()
    const id = randomUUID()
    const toolCallId = randomUUID()
    await database.db.insert(schema.permissionRequest).values({
      id,
      agentId: actor.principal.agentId,
      threadId: actor.principal.threadId,
      toolCallId,
      status: 'denied',
      resolvedBy: actor.principal.userId,
      resolvedAt: new Date(),
    })
    expect(
      (
        await actor.admit({
          action: 'apply-tool-approval',
          toolCallId,
          approved: true,
        })
      ).isErr(),
    ).toBe(true)
    expect(
      (
        await actor.admit({
          action: 'apply-tool-approval',
          toolCallId,
          approved: false,
        })
      ).isOk(),
    ).toBe(true)
    await database.db
      .update(schema.permissionRequest)
      .set({ status: 'approved' })
      .where(eq(schema.permissionRequest.id, id))
    expect(
      (await actor.admit({ action: 'execute-tool', toolCallId })).isErr(),
    ).toBe(true)
    const approval = { approved: true, request: actor.request }
    expect(
      (
        await actor.admit({ action: 'execute-tool', toolCallId, approval })
      ).isOk(),
    ).toBe(true)
    await database.db
      .delete(schema.permissionRequest)
      .where(eq(schema.permissionRequest.id, id))
    expect(
      (
        await actor.admit({ action: 'execute-tool', toolCallId, approval })
      ).isErr(),
    ).toBe(true)
  })

  it('allows only the exact terminal Decide run and attempt without borrowing a browser session', async () => {
    const actor = await fixture()
    const runId = randomUUID()
    await database.db.insert(schema.decideAnalysisRun).values({
      id: runId,
      workspaceId: actor.principal.workspaceId,
      ownerUserId: actor.principal.userId,
      ownerKind: 'chat',
      threadId: actor.principal.threadId,
      agentId: actor.principal.agentId,
      agentRuntimeName: actor.principal.runtimeName,
      idempotencyKey: randomUUID(),
      workflowInstanceId: randomUUID(),
      question: 'Fixture result',
      status: 'completed',
      attempt: 2,
      completedAt: new Date(),
    })
    const requestId = randomUUID()
    const request: ChatRequestContext = {
      version: 1,
      requestId,
      rootRequestId: requestId,
      source: {
        kind: 'submission',
        submissionId: `decide-analysis:${runId}:attempt:2`,
        metadata: {
          gardenChat: {
            kind: 'decide-result',
            runId,
            attempt: 2,
            threadId: actor.principal.threadId,
          },
        },
      },
    }
    await database.db
      .delete(schema.session)
      .where(eq(schema.session.id, actor.principal.sessionId))
    expect((await actor.admit({ request })).isOk()).toBe(true)
    await database.db
      .update(schema.decideAnalysisRun)
      .set({ attempt: 3 })
      .where(eq(schema.decideAnalysisRun.id, runId))
    expect((await actor.admit({ request })).isErr()).toBe(true)
  })
})
