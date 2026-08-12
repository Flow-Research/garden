import {
  AgentId,
  ConversationId,
  DraftId,
  EmailAddress,
  MailAddressId,
  MailboxId,
  NonEmptyString,
  UtcTimestamp,
  WorkspaceId,
} from '@garden/core/mail'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import {
  AgentCreateDraftInput,
  MailAgentApplication,
  MailAgentDeliveryDispatcher,
  type MailAgentDeliveryDispatcherService,
  MailAgentMailboxReadOnlyError,
  MailAgentPrincipal,
  makeMailAgentApplicationLayer,
} from './agent-application.ts'
import { mailDraftApplicationLayer } from './draft-application.ts'
import {
  type AccessibleMailbox,
  type ConversationDetail,
  type DraftSnapshot,
  MailDraftRevisionConflictError,
  MailRepository,
  type MailRepositoryService,
} from './repository.ts'

const ids = {
  workspace: 'ee100000-0000-4000-8000-000000000001',
  agent: 'ee100000-0000-4000-8000-000000000002',
  mailbox: 'ee100000-0000-4000-8000-000000000003',
  address: 'ee100000-0000-4000-8000-000000000004',
  conversation: 'ee100000-0000-4000-8000-000000000005',
  draft: 'ee100000-0000-4000-8000-000000000006',
} as const

const workspaceId = WorkspaceId.make(ids.workspace)
const agentId = AgentId.make(ids.agent)
const mailboxId = MailboxId.make(ids.mailbox)
const conversationId = ConversationId.make(ids.conversation)
const draftId = DraftId.make(ids.draft)
const actor = { _tag: 'Agent', agentId } as const

const draft: DraftSnapshot = {
  id: draftId,
  mailboxId,
  sender: {
    _tag: 'GardenAddress',
    addressId: MailAddressId.make(ids.address),
  },
  conversationId,
  author: actor,
  replyToMessageId: null,
  status: 'editing',
  revision: 3,
  subject: 'Investor update',
  textBody: 'Draft body',
  htmlBody: null,
  recipients: [],
  attachments: [],
  updatedAt: UtcTimestamp.make('2026-08-10T10:00:00.000Z'),
}

const conversation: ConversationDetail = {
  conversation: {
    id: conversationId,
    mailboxId,
    subject: 'Investor update',
    lastMessageAt: null,
    lastSenderName: null,
    lastSenderAddress: null,
    lastAuthor: null,
    snippet: '',
    messageCount: 0,
    unread: false,
    hasDraft: true,
    needsReply: false,
    state: null,
  },
  messages: [],
  drafts: [draft],
  assignments: [],
}

const mailbox = (accessLevel: AccessibleMailbox['accessLevel']) =>
  ({
    id: mailboxId,
    workspaceId,
    name: NonEmptyString.make('Investor Relations'),
    kind: 'shared',
    accessLevel,
    origin: 'garden_hosted',
    primaryAddress: EmailAddress.make('investors@garden.test'),
    externalAddress: null,
    sendCapability: 'garden_transport',
  }) satisfies AccessibleMailbox

/** Runs one application program against only the repository calls under test. */
const provideApplication = <A, E>(
  principal: MailAgentPrincipal,
  repository: Partial<MailRepositoryService>,
  program: Effect.Effect<A, E, MailAgentApplication>,
  dispatch: MailAgentDeliveryDispatcherService['dispatch'] = () =>
    Effect.die('Delivery dispatch was not expected.'),
) =>
  Effect.suspend(() => {
    const repositoryLayer = Layer.mock(MailRepository, repository)
    const dependencies = Layer.mergeAll(
      repositoryLayer,
      mailDraftApplicationLayer.pipe(Layer.provide(repositoryLayer)),
      Layer.succeed(
        MailAgentDeliveryDispatcher,
        MailAgentDeliveryDispatcher.of({ dispatch }),
      ),
    )
    return program.pipe(
      Effect.provide(
        makeMailAgentApplicationLayer(principal).pipe(
          Layer.provide(dependencies),
        ),
      ),
    )
  })

describe('MailAgentApplication', () => {
  it('keeps transport sender identifiers out of the model command', () => {
    expect(Object.keys(AgentCreateDraftInput.fields)).toEqual([
      'mailboxId',
      'conversationId',
      'replyToMessageId',
      'subject',
      'textBody',
      'htmlBody',
      'recipients',
      'attachments',
    ])
  })

  it.effect(
    'injects the server-owned workspace and agent actor into writes',
    () =>
      Effect.gen(function* () {
        const seen: Array<unknown> = []
        const principal = MailAgentPrincipal.make({
          workspaceId,
          agentId,
          sendExternal: 'manual',
        })
        const result = yield* provideApplication(
          principal,
          {
            createDraft: (input) => {
              seen.push(input)
              return Effect.succeed(draft)
            },
            resolveDraftSender: () => Effect.succeed(draft.sender),
            saveDraft: (input) => {
              seen.push(input)
              return Effect.succeed(draft)
            },
          },
          Effect.gen(function* () {
            const application = yield* MailAgentApplication
            yield* application.createDraft({
              mailboxId,
              conversationId,
              replyToMessageId: null,
              subject: draft.subject,
              textBody: draft.textBody,
              htmlBody: null,
              recipients: [],
              attachments: [],
            })
            return yield* application.saveDraft({
              draftId,
              expectedRevision: 3,
              subject: draft.subject,
              textBody: draft.textBody,
              htmlBody: null,
              recipients: [],
              attachments: [],
            })
          }),
        )

        expect(result).toBe(draft)
        expect(seen).toHaveLength(2)
        expect(seen).toEqual([
          expect.objectContaining({ workspaceId, author: actor }),
          expect.objectContaining({ workspaceId, actor }),
        ])
      }),
  )

  it.effect('returns an attributable approval boundary without sending', () =>
    Effect.gen(function* () {
      const outcome = yield* provideApplication(
        MailAgentPrincipal.make({
          workspaceId,
          agentId,
          sendExternal: 'manual',
        }),
        {
          getConversation: () => Effect.succeed(conversation),
          listMailboxes: () => Effect.succeed([mailbox('editor')]),
          getDraft: () => Effect.succeed(draft),
          transitionDraft: (input) =>
            Effect.succeed({
              ...draft,
              status: input.toStatus,
              revision: 4,
            }),
        },
        Effect.gen(function* () {
          const application = yield* MailAgentApplication
          return yield* application.requestDraftDelivery({
            conversationId,
            draftId,
            expectedRevision: 3,
          })
        }),
      )

      expect(outcome).toMatchObject({
        _tag: 'AwaitingApproval',
        externalSendStarted: false,
        durableApprovalRequestRecorded: true,
        approvalRecorded: false,
        deliveryWorkflowDispatched: false,
        revision: 4,
      })
    }),
  )

  it.effect(
    'dispatches auto-send policy through the durable workflow port',
    () =>
      Effect.gen(function* () {
        const outcome = yield* provideApplication(
          MailAgentPrincipal.make({
            workspaceId,
            agentId,
            sendExternal: 'auto',
          }),
          {
            getConversation: () => Effect.succeed(conversation),
            listMailboxes: () => Effect.succeed([mailbox('owner')]),
            getDraft: () => Effect.succeed(draft),
            transitionDraft: (input) =>
              Effect.succeed({
                ...draft,
                status: input.toStatus,
                revision: 4,
              }),
          },
          Effect.gen(function* () {
            const application = yield* MailAgentApplication
            return yield* application.requestDraftDelivery({
              conversationId,
              draftId,
              expectedRevision: 3,
            })
          }),
          (input) =>
            Effect.succeed({
              workflowInstanceId: `mail-${input.draftId}-${input.expectedRevision}`,
            }),
        )

        expect(outcome).toMatchObject({
          _tag: 'DeliveryWorkflowDispatched',
          workflowInstanceId: `mail-${draftId}-4`,
          deliveryWorkflowDispatched: true,
          externalSendCompleted: false,
        })
      }),
  )

  it.effect('rejects viewers and stale draft revisions', () =>
    Effect.gen(function* () {
      const principal = MailAgentPrincipal.make({
        workspaceId,
        agentId,
        sendExternal: 'manual',
      })
      const request = Effect.gen(function* () {
        const application = yield* MailAgentApplication
        return yield* application.requestDraftDelivery({
          conversationId,
          draftId,
          expectedRevision: 2,
        })
      })
      const viewerError = yield* provideApplication(
        principal,
        {
          getConversation: () => Effect.succeed(conversation),
          listMailboxes: () => Effect.succeed([mailbox('viewer')]),
        },
        request,
      ).pipe(Effect.flip)
      const revisionError = yield* provideApplication(
        principal,
        {
          getConversation: () => Effect.succeed(conversation),
          listMailboxes: () => Effect.succeed([mailbox('editor')]),
        },
        request,
      ).pipe(Effect.flip)

      expect(viewerError).toBeInstanceOf(MailAgentMailboxReadOnlyError)
      expect(revisionError).toBeInstanceOf(MailDraftRevisionConflictError)
    }),
  )
})
