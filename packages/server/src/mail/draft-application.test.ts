import {
  DraftId,
  MailAddressId,
  MailboxId,
  MemberId,
  UtcTimestamp,
  WorkspaceId,
} from '@garden/core/mail'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import {
  MailDraftApplication,
  mailDraftApplicationLayer,
} from './draft-application.ts'
import {
  type DraftSnapshot,
  MailRepository,
  type MailRepositoryService,
} from './repository.ts'

const workspaceId = WorkspaceId.make('ab100000-0000-4000-8000-000000000001')
const draftId = DraftId.make('ab100000-0000-4000-8000-000000000002')
const member = {
  _tag: 'Member' as const,
  memberId: MemberId.make('ab100000-0000-4000-8000-000000000003'),
}

const pendingDraft: DraftSnapshot = {
  id: draftId,
  mailboxId: MailboxId.make('ab100000-0000-4000-8000-000000000004'),
  fromAddressId: MailAddressId.make('ab100000-0000-4000-8000-000000000005'),
  conversationId: null,
  author: member,
  replyToMessageId: null,
  status: 'awaiting_approval',
  revision: 2,
  subject: 'Approval needed',
  textBody: 'Please review.',
  htmlBody: null,
  recipients: [],
  attachments: [],
  updatedAt: UtcTimestamp.make('2026-08-10T12:00:00.000Z'),
}

/** Provides only the repository surface required by draft policy tests. */
const provideApplication = <A, E>(
  repository: Partial<MailRepositoryService>,
  program: Effect.Effect<A, E, MailDraftApplication>,
) => {
  const repositoryLayer = Layer.mock(MailRepository, repository)
  return program.pipe(
    Effect.provide(
      mailDraftApplicationLayer.pipe(Layer.provide(repositoryLayer)),
    ),
  )
}

describe('MailDraftApplication', () => {
  it.effect(
    'records member approval before dispatching an agent-authored draft',
    () =>
      Effect.gen(function* () {
        const transitions: Array<unknown> = []
        const outcome = yield* provideApplication(
          {
            getDraft: () => Effect.succeed(pendingDraft),
            transitionDraft: (input) => {
              transitions.push(input)
              return Effect.succeed({
                ...pendingDraft,
                status: 'approved',
                revision: 3,
              })
            },
          },
          Effect.gen(function* () {
            const application = yield* MailDraftApplication
            return yield* application.requestDelivery({
              workspaceId,
              draftId,
              actor: member,
              expectedRevision: 2,
              agentApproval: 'manual',
            })
          }),
        )

        expect(transitions).toEqual([
          expect.objectContaining({
            actor: member,
            action: 'approved',
            toStatus: 'approved',
            expectedRevision: 2,
          }),
        ])
        expect(outcome).toMatchObject({
          draft: { status: 'approved', revision: 3 },
          startsDelivery: true,
          waitsForApproval: false,
        })
      }),
  )
})
