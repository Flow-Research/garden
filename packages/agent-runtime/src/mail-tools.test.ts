import * as tables from '@garden/db/schema'
import { startTestDb, type TestDb } from '@garden/db/testing'
import {
  AgentId,
  ConversationId,
  DraftId,
  MailboxId,
  WorkspaceId,
} from '@garden/core/mail'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createGardenMailTools,
  MailAgentIdentityError,
  makeMailDeliveryWorkflowDispatcher,
  resolveMailAgentPrincipal,
} from './mail-tools.ts'

const ids = {
  workspace: 'fa100000-0000-4000-8000-000000000001',
  user: 'fa100000-0000-4000-8000-000000000002',
  agent: 'fa100000-0000-4000-8000-000000000003',
  thread: 'fa100000-0000-4000-8000-000000000004',
  runtime: 'fa100000-0000-4000-8000-000000000005',
} as const

let testDb: TestDb

/** Seeds the trusted chat-thread-to-agent ownership chain used by mail tools. */
const seedAgentThread = async (): Promise<void> => {
  await testDb.db.insert(tables.user).values({
    id: ids.user,
    email: 'mail-agent@garden.test',
    name: 'Mail Agent Owner',
  })
  await testDb.db.insert(tables.organization).values({
    id: ids.workspace,
    name: 'Mail Agent Workspace',
    slug: 'mail-agent-workspace',
  })
  await testDb.db.insert(tables.agent).values({
    id: ids.agent,
    workspaceId: ids.workspace,
    ownerUserId: ids.user,
    name: 'Investor Mail Agent',
    permissions: {
      full_access: true,
      allowed_skills: [],
      allowed_connectors: [],
      allowed_tools: [],
      approval_overrides: { send_external: 'auto' },
    },
  })
  await testDb.db.insert(tables.chatThread).values({
    id: ids.thread,
    workspaceId: ids.workspace,
    ownerUserId: ids.user,
    agentId: ids.agent,
    runtimeKind: 'chat',
    runtimeKey: ids.runtime,
    title: 'Investor mail collaboration',
  })
}

describe('Garden Mail agent tools', () => {
  beforeAll(async () => {
    testDb = await startTestDb()
    await seedAgentThread()
  }, 60_000)

  afterAll(async () => {
    await testDb.cleanup()
  })

  it('derives agent identity, workspace, and send policy from server state', async () => {
    const byThread = await Effect.runPromise(
      resolveMailAgentPrincipal(testDb.db, ids.thread),
    )
    const byRuntime = await Effect.runPromise(
      resolveMailAgentPrincipal(testDb.db, ids.runtime),
    )

    expect(byThread).toEqual({
      workspaceId: ids.workspace,
      agentId: ids.agent,
      sendExternal: 'auto',
    })
    expect(byRuntime).toEqual(byThread)
  })

  it('uses manual approval when no explicit send policy exists', async () => {
    await testDb.db
      .update(tables.agent)
      .set({ permissions: null })
      .where(eq(tables.agent.id, ids.agent))

    const principal = await Effect.runPromise(
      resolveMailAgentPrincipal(testDb.db, ids.thread),
    )

    expect(principal.sendExternal).toBe('manual')
  })

  it('rejects inactive agents before any mail repository operation', async () => {
    await testDb.db
      .update(tables.agent)
      .set({ status: 'archived' })
      .where(eq(tables.agent.id, ids.agent))

    const error = await Effect.runPromise(
      resolveMailAgentPrincipal(testDb.db, ids.thread).pipe(Effect.flip),
    )

    expect(error).toBeInstanceOf(MailAgentIdentityError)
    expect(error.operation).toBe('resolvePrincipal')
  })

  it('registers only authority-free Garden Mail input contracts', () => {
    const tools = createGardenMailTools({
      databaseUrl: 'postgres://unused',
      threadId: ids.thread,
      dispatchDelivery: () => Effect.die('Tool was not executed.'),
    })

    expect(Object.keys(tools)).toEqual([
      'mail_list_mailboxes',
      'mail_list_conversations',
      'mail_read_conversation',
      'mail_create_draft',
      'mail_save_draft',
      'mail_request_draft_delivery',
    ])
  })

  it('rejects conversation escape before opening a database connection', async () => {
    const selectedConversationId = ConversationId.make(
      'fa100000-0000-4000-8000-000000000006',
    )
    const tools = createGardenMailTools({
      databaseUrl: 'postgres://must-not-connect',
      threadId: ids.thread,
      getScope: () => ({
        mailboxId: MailboxId.make('fa100000-0000-4000-8000-000000000007'),
        conversationId: selectedConversationId,
        draftOnly: false,
      }),
      dispatchDelivery: () => Effect.die('Tool was not executed.'),
    })
    const read = tools.mail_read_conversation
    if (!read?.execute)
      throw new Error('Read conversation tool is unavailable.')

    const result = await read.execute(
      {
        conversationId: ConversationId.make(
          'fa100000-0000-4000-8000-000000000008',
        ),
      },
      {
        abortSignal: undefined,
        messages: [],
        toolCallId: 'scope-test',
      },
    )

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'MailAgentScopeError',
        message: 'This mail turn is restricted to the selected conversation.',
      },
    })
  })

  it('blocks delivery requests during automatic draft turns', async () => {
    const conversationId = ConversationId.make(
      'fa100000-0000-4000-8000-000000000009',
    )
    const tools = createGardenMailTools({
      databaseUrl: 'postgres://must-not-connect',
      threadId: ids.thread,
      getScope: () => ({
        mailboxId: MailboxId.make('fa100000-0000-4000-8000-00000000000a'),
        conversationId,
        draftOnly: true,
      }),
      dispatchDelivery: () => Effect.die('Tool was not executed.'),
    })
    const delivery = tools.mail_request_draft_delivery
    if (!delivery?.execute) throw new Error('Delivery tool is unavailable.')

    const result = await delivery.execute(
      {
        conversationId,
        draftId: DraftId.make('fa100000-0000-4000-8000-00000000000b'),
        expectedRevision: 0,
      },
      {
        abortSignal: undefined,
        messages: [],
        toolCallId: 'draft-only-test',
      },
    )

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'MailAgentScopeError',
        message:
          'Automatic mailbox turns may save drafts but never request delivery.',
      },
    })
  })

  it('creates or recovers only the deterministic delivery workflow', async () => {
    const create = vi.fn(() => Promise.reject(new Error('already exists')))
    const get = vi.fn(() => Promise.resolve({ status: 'running' }))
    const dispatch = makeMailDeliveryWorkflowDispatcher({ create, get })
    const params = {
      workspaceId: WorkspaceId.make(ids.workspace),
      draftId: DraftId.make('fa100000-0000-4000-8000-000000000006'),
      actor: {
        _tag: 'Agent' as const,
        agentId: AgentId.make(ids.agent),
      },
      expectedRevision: 4,
    }

    const result = await Effect.runPromise(dispatch(params))

    expect(result.workflowInstanceId).toBe(
      `mail-${params.draftId}-${params.expectedRevision}`,
    )
    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith({
      id: result.workflowInstanceId,
      params,
    })
    expect(get).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith(result.workflowInstanceId)
  })
})
