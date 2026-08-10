import { AgentId, MemberId } from '@garden/core/mail'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  InvalidDraftTransitionError,
  decideDraftTransition,
} from './draft-state.ts'

const member = {
  _tag: 'Member' as const,
  memberId: MemberId.make('7178a1e8-c963-4842-9493-e80bb4c92d24'),
}
const agent = {
  _tag: 'Agent' as const,
  agentId: AgentId.make('34b6080d-d183-4ca3-bc40-97da17b8cf95'),
}

describe('Garden Mail draft state', () => {
  it.effect(
    'lets members send while routing manual agents through approval',
    () =>
      Effect.gen(function* () {
        const memberSend = yield* decideDraftTransition('editing', {
          _tag: 'RequestDelivery',
          actor: member,
          agentApproval: 'manual',
        })
        const agentSend = yield* decideDraftTransition('editing', {
          _tag: 'RequestDelivery',
          actor: agent,
          agentApproval: 'manual',
        })

        expect(memberSend).toMatchObject({
          toStatus: 'approved',
          startsDelivery: true,
          waitsForApproval: false,
        })
        expect(agentSend).toMatchObject({
          toStatus: 'awaiting_approval',
          startsDelivery: false,
          waitsForApproval: true,
        })
      }),
  )

  it.effect(
    'requires a member to approve and the workflow to start delivery',
    () =>
      Effect.gen(function* () {
        const approval = yield* decideDraftTransition('awaiting_approval', {
          _tag: 'Approve',
          actor: member,
        })
        const delivery = yield* decideDraftTransition(approval.toStatus, {
          _tag: 'StartApprovedDelivery',
          actor: { _tag: 'System' },
        })

        expect(approval.toStatus).toBe('approved')
        expect(delivery).toMatchObject({
          action: 'send_requested',
          toStatus: 'sending',
          startsDelivery: true,
        })
      }),
  )

  it.effect('exposes illegal transitions through the typed channel', () =>
    Effect.gen(function* () {
      const error = yield* decideDraftTransition('sent', {
        _tag: 'Discard',
        actor: member,
      }).pipe(Effect.flip)

      expect(error).toBeInstanceOf(InvalidDraftTransitionError)
      expect(error).toMatchObject({ command: 'Discard', status: 'sent' })
    }),
  )

  it.effect('records durable send failure and permits an explicit retry', () =>
    Effect.gen(function* () {
      const failed = yield* decideDraftTransition('sending', {
        _tag: 'RecordSendFailure',
        actor: { _tag: 'System' },
      })
      const retry = yield* decideDraftTransition(failed.toStatus, {
        _tag: 'RetryDelivery',
        actor: member,
      })

      expect(failed.toStatus).toBe('send_failed')
      expect(retry).toMatchObject({
        action: 'retry_requested',
        toStatus: 'sending',
        startsDelivery: true,
      })
    }),
  )
})
