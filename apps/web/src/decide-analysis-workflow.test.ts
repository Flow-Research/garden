// @vitest-environment node
import { Result } from 'better-result'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DecideAnalysisOwner,
  DecideAnalysisWorkflowParams,
} from '@garden/agent-runtime/src/decide-analysis-types'

vi.mock('cloudflare:workers', () => ({ WorkflowEntrypoint: class {} }))

const service = vi.hoisted(() => ({
  claimDecideAnalysisRun: vi.fn(),
  finishDecideAnalysis: vi.fn(),
  markDecideAnalysisProviderStarted: vi.fn(),
  markDecideAnalysisDelivered: vi.fn(),
  readDecideAnalysisForWorker: vi.fn(),
  writeDecideAnalysisProgress: vi.fn(),
}))
vi.mock('@/lib/server/decide-analysis/service', () => service)
vi.mock('@/lib/server/executor-runtime', () => ({ runExecutorForEnv: vi.fn() }))
// The package index loads AgentDO, whose decorators the test transform does
// not parse; the Workflow only needs the session ID parser from it.
vi.mock('@garden/agent-runtime', () => ({
  decideSessionIdFromResult: () => null,
}))
vi.mock('@/lib/server/executor-engine/direct-decide-mcp', () => ({
  callDirectDecideTool: vi.fn(),
  isDecideTimeLimitResult: () => false,
}))

const { DecideAnalysisWorkflow } = await import('./decide-analysis-workflow')

const DECIDE_RUN_ID = 'decide-run-1'

/**
 * Runs the Workflow for one owner. The provider step sees a cancel request,
 * so no Decide call is made, and the commit returns `finalStatus`.
 */
async function runFor(owner: DecideAnalysisOwner, finalStatus: string) {
  const sendEvent = vi.fn(async () => undefined)
  const runWorkflowGet = vi.fn(async () => ({ sendEvent }))
  const deliverDecideAnalysisResult = vi.fn(async () => ({ delivered: true }))
  const env = {
    RUN_WORKFLOW: { get: runWorkflowGet },
    AgentDO: {
      idFromName: (name: string) => name,
      get: () => ({ deliverDecideAnalysisResult }),
    },
  }
  service.claimDecideAnalysisRun.mockResolvedValue(
    Result.ok({ status: 'running' }),
  )
  service.markDecideAnalysisProviderStarted.mockResolvedValue(
    Result.ok({ kind: 'cancel_requested' }),
  )
  service.finishDecideAnalysis.mockResolvedValue(
    Result.ok({ status: finalStatus }),
  )
  service.markDecideAnalysisDelivered.mockResolvedValue(Result.ok(undefined))

  const workflow = Object.create(DecideAnalysisWorkflow.prototype) as {
    env: unknown
    run: (event: unknown, step: unknown) => Promise<unknown>
  }
  workflow.env = env
  const step = {
    do: vi.fn(async (_name: string, configOrRun: unknown, run?: unknown) => {
      const callback = (
        typeof configOrRun === 'function' ? configOrRun : run
      ) as () => Promise<unknown>
      return await callback()
    }),
  }
  const payload: DecideAnalysisWorkflowParams = {
    runId: DECIDE_RUN_ID,
    attempt: 1,
    workspaceId: 'workspace-1',
    ownerUserId: 'user-1',
    owner,
    agentRuntimeName: 'agent-1',
  }
  await workflow.run({ payload }, step)
  return { sendEvent, runWorkflowGet, deliverDecideAnalysisResult, step }
}

const automationOwner: DecideAnalysisOwner = {
  kind: 'automation_run',
  automationRunId: 'automation-run-1',
}

describe('DecideAnalysisWorkflow owner delivery', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  it.each(['completed', 'failed', 'cancelled'])(
    'wakes the owning automation RunWorkflow when the run is %s',
    async (status) => {
      const { sendEvent, runWorkflowGet, deliverDecideAnalysisResult } =
        await runFor(automationOwner, status)

      expect(runWorkflowGet).toHaveBeenCalledWith('automation-run-1')
      expect(sendEvent).toHaveBeenCalledWith({
        type: `decide-analysis-finished:${DECIDE_RUN_ID}`,
        payload: { decideRunId: DECIDE_RUN_ID, status },
      })
      expect(deliverDecideAnalysisResult).not.toHaveBeenCalled()
    },
  )

  it('wakes the automation when a cancel landed before the claim', async () => {
    const { sendEvent } = await runFor(automationOwner, 'cancelled')
    sendEvent.mockClear()
    service.claimDecideAnalysisRun.mockResolvedValue(
      Result.ok({ status: 'cancelled' }),
    )

    const workflow = Object.create(DecideAnalysisWorkflow.prototype) as {
      env: unknown
      run: (event: unknown, step: unknown) => Promise<unknown>
    }
    workflow.env = { RUN_WORKFLOW: { get: async () => ({ sendEvent }) } }
    await workflow.run(
      {
        payload: {
          runId: DECIDE_RUN_ID,
          attempt: 1,
          workspaceId: 'workspace-1',
          ownerUserId: 'user-1',
          owner: automationOwner,
          agentRuntimeName: 'agent-1',
        },
      },
      {
        do: async (_name: string, configOrRun: unknown, run?: unknown) =>
          await (
            (typeof configOrRun === 'function'
              ? configOrRun
              : run) as () => Promise<unknown>
          )(),
      },
    )

    expect(sendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: `decide-analysis-finished:${DECIDE_RUN_ID}`,
      }),
    )
  })

  it('keeps chat delivery as a chat turn and skips cancelled chat runs', async () => {
    const completed = await runFor(
      { kind: 'chat', threadId: 'thread-1' },
      'completed',
    )
    expect(completed.deliverDecideAnalysisResult).toHaveBeenCalledWith({
      threadId: 'thread-1',
      runId: DECIDE_RUN_ID,
      attempt: 1,
    })
    expect(completed.sendEvent).not.toHaveBeenCalled()

    const cancelled = await runFor(
      { kind: 'chat', threadId: 'thread-1' },
      'cancelled',
    )
    expect(cancelled.deliverDecideAnalysisResult).not.toHaveBeenCalled()
  })
})
