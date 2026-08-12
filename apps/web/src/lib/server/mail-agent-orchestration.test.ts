import * as tables from '@garden/db/schema'
import { startTestDb, type TestDb } from '@garden/db/testing'
import {
  AgentId,
  ConversationId,
  MemberId,
  WorkspaceId,
} from '@garden/core/mail'
import { Effect } from 'effect'
import { eq } from 'drizzle-orm'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  bindMailAgentTurnContext,
  consumeMailAgentDraftCapability,
  createAgentMailDraft,
  getOrCreateMailAgentChatSession,
  MailAgentOrchestrationError,
  type MailAgentChatSessionInput,
} from './mail-agent-orchestration'

const issueThreadMailContextToken = vi.hoisted(() => vi.fn())
const consumeThreadMailDraftCapability = vi.hoisted(() => vi.fn())
const getAgentByName = vi.hoisted(() =>
  vi.fn(() =>
    Promise.resolve({
      consumeThreadMailDraftCapability,
      issueThreadMailContextToken,
    }),
  ),
)

vi.mock('agents', () => ({ getAgentByName }))
vi.mock('@garden/app-state/platform/rpc', () => ({
  disposeRpcResult: (value: unknown) => value,
}))
vi.mock('@garden/agent-runtime', async () => {
  const { Schema } = await import('effect')
  const { MailboxId, MemberId, UserId, WorkspaceId, ConversationId } =
    await import('@garden/core/mail')
  return {
    MailAgentConversationContext: Schema.TaggedUnion({
      Inbox: {
        workspaceId: WorkspaceId,
        ownerUserId: UserId,
        memberId: MemberId,
      },
      Conversation: {
        workspaceId: WorkspaceId,
        ownerUserId: UserId,
        memberId: MemberId,
        mailboxId: MailboxId,
        conversationId: ConversationId,
      },
    }),
  }
})

const ids = {
  workspace: 'cb100000-0000-4000-8000-000000000001',
  userA: 'cb100000-0000-4000-8000-000000000002',
  userB: 'cb100000-0000-4000-8000-000000000003',
  memberA: 'cb100000-0000-4000-8000-000000000004',
  memberB: 'cb100000-0000-4000-8000-000000000005',
  agent: 'cb100000-0000-4000-8000-000000000006',
  mailboxA: 'cb100000-0000-4000-8000-000000000007',
  mailboxB: 'cb100000-0000-4000-8000-000000000008',
  memberAccessA: 'cb100000-0000-4000-8000-000000000009',
  memberAccessB: 'cb100000-0000-4000-8000-000000000010',
  agentAccessA: 'cb100000-0000-4000-8000-000000000011',
  agentAccessB: 'cb100000-0000-4000-8000-000000000012',
  conversationB: 'cb100000-0000-4000-8000-000000000013',
  domain: 'cb100000-0000-4000-8000-000000000014',
  addressA: 'cb100000-0000-4000-8000-000000000015',
  syncAccountB: 'cb100000-0000-4000-8000-000000000016',
} as const

let testDb: TestDb

/** Seeds disjoint member mailboxes plus one agent that can access both. */
const seedAuthorityFixture = async () => {
  await testDb.db.insert(tables.user).values([
    { id: ids.userA, email: 'member-a@garden.test', name: 'Member A' },
    { id: ids.userB, email: 'member-b@garden.test', name: 'Member B' },
  ])
  await testDb.db.insert(tables.organization).values({
    id: ids.workspace,
    name: 'Mail Agent Authority',
    slug: 'mail-agent-authority',
  })
  await testDb.db.insert(tables.member).values([
    {
      id: ids.memberA,
      organizationId: ids.workspace,
      userId: ids.userA,
      role: 'member',
    },
    {
      id: ids.memberB,
      organizationId: ids.workspace,
      userId: ids.userB,
      role: 'member',
    },
  ])
  await testDb.db.insert(tables.agent).values({
    id: ids.agent,
    workspaceId: ids.workspace,
    ownerUserId: ids.userA,
    hostName: ids.agent,
    name: 'Mailbox agent',
    status: 'active',
  })
  await testDb.db.insert(tables.mailDomain).values({
    id: ids.domain,
    workspaceId: ids.workspace,
    name: 'mail-agent-authority.test',
    status: 'active',
    transportProvider: 'test',
  })
  await testDb.db.insert(tables.mailMailbox).values([
    {
      id: ids.mailboxA,
      workspaceId: ids.workspace,
      name: 'Member A mailbox',
      kind: 'personal',
    },
    {
      id: ids.mailboxB,
      workspaceId: ids.workspace,
      name: 'Member B mailbox',
      kind: 'personal',
      origin: 'external_import',
    },
  ])
  await testDb.db.insert(tables.mailMailboxAccess).values([
    {
      id: ids.memberAccessA,
      workspaceId: ids.workspace,
      mailboxId: ids.mailboxA,
      actorType: 'member',
      memberId: ids.memberA,
      accessLevel: 'owner',
    },
    {
      id: ids.memberAccessB,
      workspaceId: ids.workspace,
      mailboxId: ids.mailboxB,
      actorType: 'member',
      memberId: ids.memberB,
      accessLevel: 'owner',
    },
    {
      id: ids.agentAccessA,
      workspaceId: ids.workspace,
      mailboxId: ids.mailboxA,
      actorType: 'agent',
      agentId: ids.agent,
      accessLevel: 'editor',
    },
    {
      id: ids.agentAccessB,
      workspaceId: ids.workspace,
      mailboxId: ids.mailboxB,
      actorType: 'agent',
      agentId: ids.agent,
      accessLevel: 'editor',
    },
  ])
  await testDb.db.insert(tables.mailAddress).values({
    id: ids.addressA,
    workspaceId: ids.workspace,
    domainId: ids.domain,
    mailboxId: ids.mailboxA,
    localPart: 'member-a',
    kind: 'primary',
    status: 'active',
  })
  await testDb.db.insert(tables.mailSyncAccount).values({
    id: ids.syncAccountB,
    workspaceId: ids.workspace,
    mailboxId: ids.mailboxB,
    userId: ids.userB,
    provider: 'gmail',
    providerEmail: 'member-b@gmail.com',
    executorIntegration: 'google_gmail',
    executorConnectionName: 'member-b-gmail',
    status: 'ready',
  })
  await testDb.db.insert(tables.mailConversation).values({
    id: ids.conversationB,
    workspaceId: ids.workspace,
    mailboxId: ids.mailboxB,
    threadKey: 'private-member-b-thread',
    subject: 'Member B only',
  })
}

/** Builds one request identity without weakening the production branded input. */
const inputFor = (
  ownerUserId: string,
  memberId: string,
  conversationId: string | null = null,
): MailAgentChatSessionInput => ({
  workspaceId: WorkspaceId.make(ids.workspace),
  ownerUserId,
  memberId: MemberId.make(memberId),
  conversationId:
    conversationId === null ? null : ConversationId.make(conversationId),
  agentId: AgentId.make(ids.agent),
})

describe('mail agent session authority', () => {
  beforeAll(async () => {
    testDb = await startTestDb()
    await seedAuthorityFixture()
  }, 60_000)

  afterAll(async () => {
    await testDb.cleanup()
  })

  beforeEach(async () => {
    getAgentByName.mockClear()
    issueThreadMailContextToken.mockReset()
    consumeThreadMailDraftCapability.mockReset()
    await testDb.db.delete(tables.mailDraftActivity)
    await testDb.db.delete(tables.mailDraftRecipient)
    await testDb.db.delete(tables.mailDraft)
    await testDb.db.delete(tables.chatThread)
  })

  it('rejects draft persistence without the owner-specific hidden session', async () => {
    const error = await Effect.runPromise(
      createAgentMailDraft(testDb.db, inputFor(ids.userA, ids.memberA), {
        mode: 'new',
        to: 'customer@example.com',
        body: 'Draft body',
      }).pipe(Effect.flip),
    )

    expect(error).toBeInstanceOf(MailAgentOrchestrationError)
    expect(error.operation).toBe('requireChatThread')
  })

  it('persists the exact agent-authored revision through Postgres', async () => {
    await Effect.runPromise(
      getOrCreateMailAgentChatSession(
        testDb.db,
        inputFor(ids.userA, ids.memberA),
      ),
    )

    const draft = await Effect.runPromise(
      createAgentMailDraft(testDb.db, inputFor(ids.userA, ids.memberA), {
        mode: 'new',
        to: 'CUSTOMER@example.com',
        cc: 'ops@example.com',
        subject: 'Canonical agent draft',
        body: 'Review this before sending.',
      }),
    )
    const stored = await testDb.db
      .select({
        authorType: tables.mailDraft.authorType,
        authorAgentId: tables.mailDraft.authorAgentId,
        authorMemberId: tables.mailDraft.authorMemberId,
        fromAddressId: tables.mailDraft.fromAddressId,
        revision: tables.mailDraft.revision,
      })
      .from(tables.mailDraft)
      .where(eq(tables.mailDraft.id, draft.id))
      .limit(1)

    expect(draft).toMatchObject({
      author: { _tag: 'Agent', agentId: ids.agent },
      mailboxId: ids.mailboxA,
      conversationId: null,
      revision: 0,
      subject: 'Canonical agent draft',
      textBody: 'Review this before sending.',
      recipients: expect.arrayContaining([
        expect.objectContaining({
          kind: 'to',
          address: 'customer@example.com',
          position: 0,
        }),
        expect.objectContaining({
          kind: 'cc',
          address: 'ops@example.com',
          position: 1,
        }),
      ]),
    })
    expect(stored[0]).toEqual({
      authorType: 'agent',
      authorAgentId: ids.agent,
      authorMemberId: null,
      fromAddressId: ids.addressA,
      revision: 0,
    })
  })

  it('resolves a Gmail sender from the active external sync account', async () => {
    await Effect.runPromise(
      getOrCreateMailAgentChatSession(
        testDb.db,
        inputFor(ids.userB, ids.memberB),
      ),
    )

    const draft = await Effect.runPromise(
      createAgentMailDraft(testDb.db, inputFor(ids.userB, ids.memberB), {
        mode: 'new',
        to: 'customer@example.com',
        subject: 'Gmail agent draft',
        body: 'Review before sending.',
      }),
    )
    const [stored] = await testDb.db
      .select({
        fromAddressId: tables.mailDraft.fromAddressId,
        fromSyncAccountId: tables.mailDraft.fromSyncAccountId,
      })
      .from(tables.mailDraft)
      .where(eq(tables.mailDraft.id, draft.id))
      .limit(1)

    expect(draft.sender).toEqual({
      _tag: 'ExternalAccount',
      syncAccountId: ids.syncAccountB,
    })
    expect(stored).toEqual({
      fromAddressId: null,
      fromSyncAccountId: ids.syncAccountB,
    })
  })

  it('rejects direct draft attribution without a runtime-minted capability', async () => {
    await Effect.runPromise(
      getOrCreateMailAgentChatSession(
        testDb.db,
        inputFor(ids.userA, ids.memberA),
      ),
    )
    consumeThreadMailDraftCapability.mockRejectedValue(
      new Error('Mail draft capability is invalid'),
    )

    const error = await Effect.runPromise(
      consumeMailAgentDraftCapability(
        testDb.db,
        { AgentDO: {} as never },
        inputFor(ids.userA, ids.memberA),
        'forged-capability',
        { mode: 'new', to: 'customer@example.com', body: 'Forged' },
      ).pipe(Effect.flip),
    )

    expect(error).toBeInstanceOf(MailAgentOrchestrationError)
    expect(error.operation).toBe('consumeDraftCapability.rpc')
  })

  it('uses immutable turn context after the browser selection changes', async () => {
    const session = await Effect.runPromise(
      getOrCreateMailAgentChatSession(
        testDb.db,
        inputFor(ids.userB, ids.memberB),
      ),
    )
    consumeThreadMailDraftCapability.mockResolvedValue({
      workspaceId: ids.workspace,
      ownerUserId: ids.userB,
      memberId: ids.memberB,
      mailboxId: ids.mailboxB,
      conversationId: ids.conversationB,
    })

    const immutable = await Effect.runPromise(
      consumeMailAgentDraftCapability(
        testDb.db,
        { AgentDO: {} as never },
        inputFor(ids.userB, ids.memberB),
        'server-capability',
        { mode: 'reply', body: 'Bound to the original email' },
      ),
    )

    expect(immutable.conversationId).toBe(ids.conversationB)
    expect(consumeThreadMailDraftCapability).toHaveBeenCalledWith(
      session.runtime_key,
      'server-capability',
      { mode: 'reply', body: 'Bound to the original email' },
    )
  })

  it('creates independent, unguessable runtimes for different members', async () => {
    const sessionA = await Effect.runPromise(
      getOrCreateMailAgentChatSession(
        testDb.db,
        inputFor(ids.userA, ids.memberA),
      ),
    )
    const sessionB = await Effect.runPromise(
      getOrCreateMailAgentChatSession(
        testDb.db,
        inputFor(ids.userB, ids.memberB),
      ),
    )
    const reopenedA = await Effect.runPromise(
      getOrCreateMailAgentChatSession(
        testDb.db,
        inputFor(ids.userA, ids.memberA),
      ),
    )

    expect(sessionA.id).not.toBe(sessionB.id)
    expect(sessionA.runtime_key).not.toBe(sessionA.id)
    expect(sessionB.runtime_key).not.toBe(sessionB.id)
    expect(reopenedA.runtime_key).toBe(sessionA.runtime_key)
  })

  it('denies a conversation outside the member and agent intersection', async () => {
    const error = await Effect.runPromise(
      getOrCreateMailAgentChatSession(
        testDb.db,
        inputFor(ids.userA, ids.memberA, ids.conversationB),
      ).pipe(Effect.flip),
    )

    expect(error).toBeInstanceOf(MailAgentOrchestrationError)
    expect(error.operation).toBe('resolveAuthority')
    expect(issueThreadMailContextToken).not.toHaveBeenCalled()
  })

  it('denies a member identity paired with a different thread owner', async () => {
    const error = await Effect.runPromise(
      bindMailAgentTurnContext(
        testDb.db,
        { AgentDO: {} as never },
        inputFor(ids.userB, ids.memberA),
      ).pipe(Effect.flip),
    )

    expect(error).toBeInstanceOf(MailAgentOrchestrationError)
    expect(error.operation).toBe('resolveAuthority')
    expect(issueThreadMailContextToken).not.toHaveBeenCalled()
  })

  it('issues Inbox context only through the owner-specific hidden runtime', async () => {
    issueThreadMailContextToken.mockResolvedValue({ token: 'opaque-token' })

    const binding = await Effect.runPromise(
      bindMailAgentTurnContext(
        testDb.db,
        { AgentDO: {} as never },
        inputFor(ids.userA, ids.memberA),
      ),
    )
    const session = await Effect.runPromise(
      getOrCreateMailAgentChatSession(
        testDb.db,
        inputFor(ids.userA, ids.memberA),
      ),
    )

    expect(binding).toEqual({ token: 'opaque-token' })
    expect(issueThreadMailContextToken).toHaveBeenCalledWith(
      session.runtime_key,
      {
        _tag: 'Inbox',
        workspaceId: ids.workspace,
        ownerUserId: ids.userA,
        memberId: ids.memberA,
      },
    )
  })
})
