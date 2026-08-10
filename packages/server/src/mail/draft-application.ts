import {
  RequestDraftDeliveryInput,
  TransitionDraftInput,
} from '@garden/core/mail'
import { Context, Effect, Layer, Schema } from 'effect'
import {
  decideDraftTransition,
  type DraftCommand,
  type InvalidDraftTransitionError,
} from './draft-state.ts'
import {
  DraftSnapshot,
  MailRepository,
  type MailRepositoryError,
} from './repository.ts'

export const DraftDeliveryAuthorization = Schema.Struct({
  draft: DraftSnapshot,
  startsDelivery: Schema.Boolean,
  waitsForApproval: Schema.Boolean,
})
export interface DraftDeliveryAuthorization extends Schema.Schema.Type<
  typeof DraftDeliveryAuthorization
> {}

export type MailDraftApplicationError =
  | MailRepositoryError
  | InvalidDraftTransitionError

export type MemberDraftCommandInput = Omit<
  RequestDraftDeliveryInput,
  'actor'
> & {
  readonly actor: Extract<
    RequestDraftDeliveryInput['actor'],
    { readonly _tag: 'Member' }
  >
}

export interface MailDraftApplicationService {
  readonly requestDelivery: (
    input: RequestDraftDeliveryInput & {
      agentApproval: 'auto' | 'manual'
    },
  ) => Effect.Effect<DraftDeliveryAuthorization, MailDraftApplicationError>
  readonly requestChanges: (
    input: MemberDraftCommandInput,
  ) => Effect.Effect<DraftSnapshot, MailDraftApplicationError>
  readonly discard: (
    input: MemberDraftCommandInput,
  ) => Effect.Effect<DraftSnapshot, MailDraftApplicationError>
}

/** Effect application authority for draft policy before durable delivery. */
export class MailDraftApplication extends Context.Service<
  MailDraftApplication,
  MailDraftApplicationService
>()('@garden/server/MailDraftApplication') {}

/**
 * Applies human/agent delivery policy before creating a Workflow. An approved
 * draft is idempotently dispatchable; only the Workflow reservation changes it
 * to `sending`, so no state can claim an in-flight send without an attempt.
 */
export const mailDraftApplicationLayer: Layer.Layer<
  MailDraftApplication,
  never,
  MailRepository
> = Layer.effect(
  MailDraftApplication,
  Effect.gen(function* () {
    const repository = yield* MailRepository

    /** Decides and persists one member collaboration command with its attribution. */
    const transitionMemberDraft = Effect.fn(
      'MailDraftApplication.transitionMemberDraft',
    )(function* (
      input: MemberDraftCommandInput,
      command: Extract<
        DraftCommand,
        { readonly _tag: 'RequestChanges' | 'Discard' }
      >,
    ) {
      const current = yield* repository.getDraft(input)
      const transition = yield* decideDraftTransition(current.status, command)
      return yield* repository.transitionDraft(
        TransitionDraftInput.make({
          workspaceId: input.workspaceId,
          draftId: input.draftId,
          actor: transition.actor,
          expectedRevision: input.expectedRevision,
          action: transition.action,
          toStatus: transition.toStatus,
        }),
      )
    })

    return MailDraftApplication.of({
      requestDelivery: Effect.fn('MailDraftApplication.requestDelivery')(
        function* (input) {
          const current = yield* repository.getDraft(input)
          if (current.status === 'approved') {
            return {
              draft: current,
              startsDelivery: true,
              waitsForApproval: false,
            }
          }
          if (current.status === 'send_failed') {
            return {
              draft: current,
              startsDelivery: true,
              waitsForApproval: false,
            }
          }
          if (
            current.status === 'awaiting_approval' &&
            input.actor._tag === 'Member'
          ) {
            const approval = yield* decideDraftTransition(current.status, {
              _tag: 'Approve',
              actor: input.actor,
            })
            const draft = yield* repository.transitionDraft(
              TransitionDraftInput.make({
                workspaceId: input.workspaceId,
                draftId: input.draftId,
                actor: approval.actor,
                expectedRevision: input.expectedRevision,
                action: approval.action,
                toStatus: approval.toStatus,
              }),
            )
            return {
              draft,
              startsDelivery: true,
              waitsForApproval: false,
            }
          }
          const transition = yield* decideDraftTransition(current.status, {
            _tag: 'RequestDelivery',
            actor: input.actor,
            agentApproval: input.agentApproval,
          })
          const transitionInput = TransitionDraftInput.make({
            workspaceId: input.workspaceId,
            draftId: input.draftId,
            actor: transition.actor,
            expectedRevision: input.expectedRevision,
            action: transition.action,
            toStatus: transition.toStatus,
          })
          const draft = yield* repository.transitionDraft(transitionInput)
          return {
            draft,
            startsDelivery: transition.startsDelivery,
            waitsForApproval: transition.waitsForApproval,
          }
        },
      ),
      requestChanges: Effect.fn('MailDraftApplication.requestChanges')(
        (input) =>
          transitionMemberDraft(input, {
            _tag: 'RequestChanges',
            actor: input.actor,
          }),
      ),
      discard: Effect.fn('MailDraftApplication.discard')((input) =>
        transitionMemberDraft(input, {
          _tag: 'Discard',
          actor: input.actor,
        }),
      ),
    })
  }),
)
