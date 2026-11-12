import { describe, expect, it, vi } from 'vitest'
import { RunWorkflow } from './run-workflow'
import { MAX_TURN_EVENT_CHECKS } from './run-workflow-turn-wait'
import {
  DECIDE_ANALYSIS_OWNER_WAIT_MS,
  DECIDE_ANALYSIS_TIME_LIMIT_MS,
} from './decide-analysis-types'

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
      expect.objectContaining({ type: 'run-turn-complete-submission-1' }),
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

type AutomationAgent = {
  executeAutomationRunTurn: ReturnType<typeof vi.fn>
  completeAutomationRunTurn: ReturnType<typeof vi.fn>
}

/**
 * An automation run whose first turn starts a Decide analysis and whose
 * second turn finishes the run. `waitForEvent` resolves unless the event type
 * is in `missedEvents`, which models a wait that times out.
 */
function automationSetup(input: {
  decideSettled: boolean
  missedEvents?: readonly string[]
}) {
  const workflow = Object.create(RunWorkflow.prototype) as {
    agent: AutomationAgent
    run: (
      event: { payload: { kind: 'automation'; runId: string } },
      step: unknown,
    ) => Promise<{ runId: string; status: string }>
  }
  const agent: AutomationAgent = {
    executeAutomationRunTurn: vi.fn(async ({ turn }: { turn: number }) => ({
      kind: 'submitted',
      submissionId: `submission-${turn}`,
      submissionStatus: 'completed',
    })),
    completeAutomationRunTurn: vi
      .fn()
      .mockResolvedValueOnce({
        status: 'running',
        waitingOn: {
          kind: 'decide_analysis',
          decideRunId: 'decide-1',
          settled: input.decideSettled,
        },
      })
      .mockResolvedValueOnce({ status: 'completed' }),
  }
  workflow.agent = agent
  const step = {
    do: vi.fn(
      async (
        _name: string,
        _config: unknown,
        callback: () => Promise<unknown>,
      ) => await callback(),
    ),
    waitForEvent: vi.fn(async (name: string, options: { type: string }) => {
      if (input.missedEvents?.includes(options.type)) {
        throw new Error('timed out')
      }
      return { payload: {}, type: name }
    }),
    reportComplete: vi.fn(async () => undefined),
  }
  return { workflow, agent, step }
}

const automationEvent = {
  payload: { kind: 'automation' as const, runId: 'automation-run-1' },
}

describe('RunWorkflow Decide pause', () => {
  it('waits for the Decide event, then resumes the agent with that run', async () => {
    const { workflow, agent, step } = automationSetup({ decideSettled: false })

    const result = await workflow.run(automationEvent, step)

    expect(result).toEqual({ runId: 'automation-run-1', status: 'completed' })
    expect(step.waitForEvent).toHaveBeenCalledWith('turn-0-decide-analysis', {
      type: 'decide-analysis-finished:decide-1',
      timeout: DECIDE_ANALYSIS_OWNER_WAIT_MS,
    })
    expect(agent.executeAutomationRunTurn).toHaveBeenNthCalledWith(2, {
      runId: 'automation-run-1',
      mode: 'resume',
      turn: 1,
      decideRunId: 'decide-1',
    })
  })

  it('bounds the wait just past the Decide provider limit', () => {
    expect(DECIDE_ANALYSIS_OWNER_WAIT_MS).toBeGreaterThan(
      DECIDE_ANALYSIS_TIME_LIMIT_MS + 60_000,
    )
    expect(DECIDE_ANALYSIS_OWNER_WAIT_MS).toBeLessThanOrEqual(
      DECIDE_ANALYSIS_TIME_LIMIT_MS + 15 * 60_000,
    )
  })

  it('skips the wait when Decide already finished', async () => {
    const { workflow, agent, step } = automationSetup({ decideSettled: true })

    await workflow.run(automationEvent, step)

    expect(step.waitForEvent).not.toHaveBeenCalledWith(
      'turn-0-decide-analysis',
      expect.anything(),
    )
    expect(agent.executeAutomationRunTurn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ mode: 'resume', decideRunId: 'decide-1' }),
    )
  })

  it('still resumes the agent when the Decide event never arrives', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { workflow, agent, step } = automationSetup({
      decideSettled: false,
      missedEvents: ['decide-analysis-finished:decide-1'],
    })

    const result = await workflow.run(automationEvent, step)

    expect(result.status).toBe('completed')
    expect(agent.executeAutomationRunTurn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ mode: 'resume', decideRunId: 'decide-1' }),
    )
  })
})

describe('RunWorkflow run status invariant', () => {
  it('fails the run instead of completing while the run row is still live', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const workflow = Object.create(RunWorkflow.prototype) as {
      agent: Record<string, ReturnType<typeof vi.fn>>
      run: (
        event: {
          payload: { kind: 'issue'; runId: string; issueId: string }
        },
        step: unknown,
      ) => Promise<{ runId: string; status: string }>
    }
    workflow.agent = {
      executeRunTurn: vi.fn(async () => ({
        kind: 'submitted',
        submissionId: 'submission-0',
        submissionStatus: 'completed',
      })),
      completeRunTurn: vi.fn(async () => ({ status: 'running' })),
      failRunTurn: vi.fn(async () => ({ status: 'failed' })),
    }
    const step = {
      do: vi.fn(
        async (
          _name: string,
          _config: unknown,
          callback: () => Promise<unknown>,
        ) => await callback(),
      ),
      waitForEvent: vi.fn(),
      reportComplete: vi.fn(async () => undefined),
    }

    const result = await workflow.run(
      { payload: { kind: 'issue', runId: 'run-1', issueId: 'issue-1' } },
      step,
    )

    expect(workflow.agent.failRunTurn).toHaveBeenCalledWith({
      runId: 'run-1',
      issueId: 'issue-1',
      reason: 'workflow_ended_with_live_run',
    })
    expect(result).toEqual({ runId: 'run-1', status: 'failed' })
    expect(step.reportComplete).toHaveBeenCalledWith({
      runId: 'run-1',
      status: 'failed',
    })
  })
})
