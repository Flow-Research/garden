import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import type { ExecutionEngine } from '@executor-js/execution/core'

import {
  MAX_EXECUTOR_OUTPUT_CHARACTERS,
  boundExecutionEngine,
  boundExecutorOutput,
} from './output-bound'

const oversizedResult = 'x'.repeat(MAX_EXECUTOR_OUTPUT_CHARACTERS + 25)

/** Builds the narrow engine fixture used to exercise every output boundary. */
const makeEngine = (): ExecutionEngine<never> => ({
  execute: () =>
    Effect.succeed({ result: oversizedResult, logs: [oversizedResult] }),
  executeWithPause: () =>
    Effect.succeed({
      status: 'completed',
      result: { result: oversizedResult, logs: [oversizedResult] },
    }),
  resume: () =>
    Effect.succeed({
      status: 'completed',
      result: { result: oversizedResult, logs: [oversizedResult] },
    }),
  getPausedExecution: () => Effect.succeed(null),
  pausedExecutionCount: () => Effect.succeed(0),
  hasPausedExecutions: () => Effect.succeed(false),
  getDescription: Effect.succeed('test executor'),
})

describe('Executor MCP output boundary', () => {
  it('bounds unknown values with explicit truncation metadata', async () => {
    const bounded = await Effect.runPromise(
      boundExecutorOutput(oversizedResult),
    )

    expect(bounded.truncated).toBe(true)
    expect(bounded.originalCharacters).toBe(oversizedResult.length)
    expect(bounded.text).toContain('[truncated 25 chars]')
  })

  it('removes unbounded logs from execute and resume results', async () => {
    const engine = boundExecutionEngine(makeEngine())
    const execute = await Effect.runPromise(
      engine.execute('return 1', {
        onElicitation: () => Effect.succeed({ action: 'decline' }),
      }),
    )
    const resumed = await Effect.runPromise(
      engine.resume('exec_1', { action: 'accept' }),
    )

    expect(execute.logs).toEqual([])
    expect(String(execute.result)).toContain('[truncated 25 chars]')
    expect(resumed).toMatchObject({
      status: 'completed',
      result: { logs: [] },
    })
  })
})
