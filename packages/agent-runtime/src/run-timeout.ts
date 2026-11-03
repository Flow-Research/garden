/**
 * Whether a run has outlived the agent's `runTimeoutSec`. Before, the guard
 * measured wall-clock time since the run started, so an automation run that
 * waited an hour on Decide could resume only to be failed as `timeout`
 * although its agent had barely worked. Time the run spent paused in its
 * Workflow (`pausedMs`, today the time its Decide analyses ran) is Workflow
 * time, not turn time, so it no longer counts.
 */
export function runExceededTimeout(input: {
  startedAt: Date | null
  timeoutSec: number
  pausedMs: number
  now: Date
}) {
  if (input.startedAt === null) return false
  const workingMs =
    input.now.getTime() - input.startedAt.getTime() - input.pausedMs
  return workingMs > input.timeoutSec * 1000
}
