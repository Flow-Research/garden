import {
  DraftActivityAction,
  DraftStatus,
  MailActionActor,
  MailActor,
} from '@garden/core/mail'
import { Effect, Schema } from 'effect'

export const DraftCommand = Schema.TaggedUnion({
  RequestDelivery: {
    actor: MailActor,
    agentApproval: Schema.Literals(['auto', 'manual']),
  },
  Approve: { actor: MailActionActor },
  RequestChanges: { actor: MailActionActor },
  StartApprovedDelivery: { actor: MailActionActor },
  RecordSent: { actor: MailActionActor },
  RecordSendFailure: { actor: MailActionActor },
  RetryDelivery: { actor: MailActor },
  Discard: { actor: MailActor },
})
export type DraftCommand = typeof DraftCommand.Type

export const DraftTransition = Schema.Struct({
  actor: MailActionActor,
  action: DraftActivityAction,
  fromStatus: DraftStatus,
  toStatus: DraftStatus,
  startsDelivery: Schema.Boolean,
  waitsForApproval: Schema.Boolean,
})
export interface DraftTransition extends Schema.Schema.Type<
  typeof DraftTransition
> {}

/** A command is well-formed but illegal for the draft's current state or actor. */
export class InvalidDraftTransitionError extends Schema.TaggedErrorClass<InvalidDraftTransitionError>()(
  'InvalidDraftTransitionError',
  {
    command: Schema.String,
    status: DraftStatus,
    message: Schema.String,
  },
) {}

const actionActor = (actor: MailActor): MailActionActor =>
  actor._tag === 'Member'
    ? { _tag: 'Member', memberId: actor.memberId }
    : { _tag: 'Agent', agentId: actor.agentId }

const invalidTransition = (
  status: DraftStatus,
  command: DraftCommand,
  message: string,
): InvalidDraftTransitionError =>
  new InvalidDraftTransitionError({
    command: command._tag,
    status,
    message,
  })

const transition = (
  actor: MailActionActor,
  action: DraftActivityAction,
  fromStatus: DraftStatus,
  toStatus: DraftStatus,
  flags: {
    readonly startsDelivery?: boolean
    readonly waitsForApproval?: boolean
  } = {},
): DraftTransition => ({
  actor,
  action,
  fromStatus,
  toStatus,
  startsDelivery: flags.startsDelivery ?? false,
  waitsForApproval: flags.waitsForApproval ?? false,
})

/**
 * Owns every non-edit draft status transition. Agent delivery observes the
 * existing `send_external` approval override; members send directly. Durable
 * workflows consume the returned flags and remain the only retry boundary.
 */
export const decideDraftTransition = Effect.fn('DraftState.decideTransition')(
  function* (status: DraftStatus, command: DraftCommand) {
    switch (command._tag) {
      case 'RequestDelivery': {
        if (status !== 'editing' && status !== 'approved') {
          return yield* invalidTransition(
            status,
            command,
            'Only an editable or approved draft can be sent.',
          )
        }

        const requiresApproval =
          command.actor._tag === 'Agent' && command.agentApproval === 'manual'
        return requiresApproval
          ? transition(
              actionActor(command.actor),
              'submitted_for_approval',
              status,
              'awaiting_approval',
              { waitsForApproval: true },
            )
          : transition(
              actionActor(command.actor),
              'send_requested',
              status,
              'approved',
              { startsDelivery: true },
            )
      }

      case 'Approve': {
        if (status !== 'awaiting_approval' || command.actor._tag !== 'Member') {
          return yield* invalidTransition(
            status,
            command,
            'A member can approve only a draft awaiting approval.',
          )
        }
        return transition(command.actor, 'approved', status, 'approved')
      }

      case 'RequestChanges': {
        if (status !== 'awaiting_approval' || command.actor._tag !== 'Member') {
          return yield* invalidTransition(
            status,
            command,
            'A member can request changes only while approval is pending.',
          )
        }
        return transition(command.actor, 'changes_requested', status, 'editing')
      }

      case 'StartApprovedDelivery': {
        if (status !== 'approved' || command.actor._tag !== 'System') {
          return yield* invalidTransition(
            status,
            command,
            'The durable mail workflow starts only an approved draft.',
          )
        }
        return transition(command.actor, 'send_requested', status, 'sending', {
          startsDelivery: true,
        })
      }

      case 'RecordSent': {
        if (status !== 'sending' || command.actor._tag !== 'System') {
          return yield* invalidTransition(
            status,
            command,
            'Only the durable mail workflow can complete an active send.',
          )
        }
        return transition(command.actor, 'sent', status, 'sent')
      }

      case 'RecordSendFailure': {
        if (status !== 'sending' || command.actor._tag !== 'System') {
          return yield* invalidTransition(
            status,
            command,
            'Only the durable mail workflow can record a send failure.',
          )
        }
        return transition(command.actor, 'send_failed', status, 'send_failed')
      }

      case 'RetryDelivery': {
        if (status !== 'send_failed') {
          return yield* invalidTransition(
            status,
            command,
            'Only a failed send can be retried.',
          )
        }
        return transition(
          actionActor(command.actor),
          'retry_requested',
          status,
          'sending',
          { startsDelivery: true },
        )
      }

      case 'Discard': {
        if (
          status === 'sending' ||
          status === 'sent' ||
          status === 'discarded'
        ) {
          return yield* invalidTransition(
            status,
            command,
            'An active, sent, or discarded draft cannot be discarded.',
          )
        }
        return transition(
          actionActor(command.actor),
          'discarded',
          status,
          'discarded',
        )
      }
    }
  },
)
