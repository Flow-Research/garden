import { describe, expect, it, vi } from 'vitest'
import { RunWorkflow } from './run-workflow'
import { MAX_TURN_EVENT_CHECKS } from './run-workflow-turn-wait'

vi.mock('agents/workflows', () => ({
  AgentWorkflow: class {},
}))

type FakeAgent = {
  completeRunTurn: ReturnType<typeof vi.fn>
  readRunTurnStatus: ReturnType<typeof vi.fn>
  failRunTurn: ReturnType<typeof vi.fn>
}

/** The private wait the tests drive, with the inputs it reads. */
type WorkflowInternals = {
  agent: FakeAgent
  waitForSubmittedTurnCompletion: (input: {
    event: { payload: { kind: 'issue'; runId: string; issueId: string } }
    runId: string
    started: {
      kind: 'submitted'
      submissionId: string
      submissionStatus: string
    }
    step: FakeStep
    turn: number
  }) => Promise<{ status: string }>
}

type FakeStep = ReturnType<typeof fakeStep>

/**
 * A Workflow step that runs `do` callbacks inline and resolves each
 * `waitForEvent` from `eventArrives` (false = the wait times out).
 */
function fakeStep(eventArrives: (waitIndex: number) => boolean) {
  let waits = 0
  return {
    waitForEvent: vi.fn(async (name: string) => {
      if (eventArrives(waits++)) return { payload: {}, type: name }
      throw new Error('timed out')
    }),
    do: vi.fn(
      async (
        _name: string,
        _config: unknown,
        callback: () => Promise<unknown>,
      ) => await callback(),
    ),
  }
}

function setup(statuses: Array<string | null>) {
  const workflow = Object.create(RunWorkflow.prototype) as WorkflowInternals
  const agent: FakeAgent = {
    completeRunTurn: vi.fn(async () => ({ status: 'succeeded' })),
    readRunTurnStatus: vi.fn(async () => ({
      status: statuses.shift() ?? 'running',
    })),
    failRunTurn: vi.fn(async () => ({ status: 'failed' })),
  }
  workflow.agent = agent
  return { workflow, agent }
}

function waitInput(step: FakeStep) {
  return {
    event: {
      payload: { kind: 'issue' as const, runId: 'run-1', issueId: 'issue-1' },
    },
    runId: 'run-1',
    started: {
      kind: 'submitted' as const,
      submissionId: 'submission-1',
      submissionStatus: 'running',
    },
    step,
    turn: 0,
  }
}

describe('RunWorkflow turn completion', () => {
  it('completes the turn when its event arrives', async () => {
    const { workflow, agent } = setup([])
    const step = fakeStep(() => true)

    const result = await workflow.waitForSubmittedTurnCompletion(
      waitInput(step),
    )

    expect(result).toEqual({ status: 'succeeded' })
    expect(agent.readRunTurnStatus).not.toHaveBeenCalled()
    expect(step.waitForEvent).toHaveBeenCalledWith(
      'turn-0-complete-event',
      expect.objectContaining({ type: 'run-turn-complete:submission-1' }),
    )
  })

  it('recovers from a lost event once Think reports the turn finished', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { workflow, agent } = setup(['running', 'completed'])
    const step = fakeStep(() => false)

    const result = await workflow.waitForSubmittedTurnCompletion(
      waitInput(step),
    )

    expect(result).toEqual({ status: 'succeeded' })
    expect(agent.readRunTurnStatus).toHaveBeenCalledTimes(2)
    expect(agent.completeRunTurn).toHaveBeenCalledWith({
      runId: 'run-1',
      issueId: 'issue-1',
      submissionId: 'submission-1',
    })
    expect(agent.failRunTurn).not.toHaveBeenCalled()
  })

  it('keeps waiting while the turn runs and completes on a later event', async () => {
    const { workflow, agent } = setup(['running'])
    const step = fakeStep((waitIndex) => waitIndex === 1)

    const result = await workflow.waitForSubmittedTurnCompletion(
      waitInput(step),
    )

    expect(result).toEqual({ status: 'succeeded' })
    expect(step.waitForEvent).toHaveBeenNthCalledWith(
      2,
      'turn-0-complete-event-1',
      expect.anything(),
    )
    expect(agent.readRunTurnStatus).toHaveBeenCalledTimes(1)
  })

  it('fails the run when the turn never settles', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { workflow, agent } = setup([])
    const step = fakeStep(() => false)

    const result = await workflow.waitForSubmittedTurnCompletion(
      waitInput(step),
    )

    expect(result).toEqual({ status: 'failed' })
    expect(step.waitForEvent).toHaveBeenCalledTimes(MAX_TURN_EVENT_CHECKS)
    expect(agent.failRunTurn).toHaveBeenCalledWith({
      runId: 'run-1',
      issueId: 'issue-1',
      reason: 'turn_timed_out',
    })
    expect(agent.completeRunTurn).not.toHaveBeenCalled()
  })

  it('surfaces a status check that keeps failing so Workflow retries the step', async () => {
    const { workflow, agent } = setup([])
    agent.readRunTurnStatus.mockRejectedValue(new Error('agent unavailable'))
    const step = fakeStep(() => false)

    await expect(
      workflow.waitForSubmittedTurnCompletion(waitInput(step)),
    ).rejects.toThrow('agent unavailable')
    expect(agent.failRunTurn).not.toHaveBeenCalled()
  })
})
