import type { AgentWorkflowStep } from 'agents/workflows'
import { isTerminalSubmissionStatus } from './runtime-utils'

/** How long Workflow waits for a turn-complete event before asking Think. */
export const TURN_EVENT_CHECK_INTERVAL = '5 minutes'
/** Checks before a turn that never settles is failed: six hours. */
export const MAX_TURN_EVENT_CHECKS = 72

export type TurnSettleOutcome = 'event' | 'reconciled' | 'timed_out'

type TurnWaitStep = Pick<AgentWorkflowStep, 'waitForEvent' | 'do'>
type StepRetries = NonNullable<
  NonNullable<Parameters<AgentWorkflowStep['do']>[1]>['retries']
>

/**
 * Waits for a submitted turn to settle. The turn-complete event sent from the
 * agent DO is the fast path, but its delivery can fail, and a Workflow waiting
 * on a lost event used to sit until the platform timeout and then fail
 * without closing the run. Each wait is therefore bounded, and after a
 * timeout Think's own submission ledger is checked: a terminal submission
 * counts as settled. `timed_out` means the turn never settled; the caller
 * fails the run.
 */
export async function waitForTurnToSettle(input: {
  step: TurnWaitStep
  turn: number
  eventType: string
  retries: StepRetries
  readStatus: () => Promise<{ status: string | null }>
}): Promise<TurnSettleOutcome> {
  for (let check = 0; check < MAX_TURN_EVENT_CHECKS; check++) {
    // The first wait keeps its original step name, so instances that were
    // already waiting when this shipped replay onto it.
    const waitName =
      check === 0
        ? `turn-${input.turn}-complete-event`
        : `turn-${input.turn}-complete-event-${check}`
    const received = await input.step
      .waitForEvent(waitName, {
        type: input.eventType,
        timeout: TURN_EVENT_CHECK_INTERVAL,
      })
      .then(
        () => true,
        () => false,
      )
    if (received) return 'event'

    const { status } = await input.step.do(
      `turn-${input.turn}-status-check-${check}`,
      { retries: input.retries },
      input.readStatus,
    )
    if (status && isTerminalSubmissionStatus(status)) return 'reconciled'
  }
  return 'timed_out'
}
