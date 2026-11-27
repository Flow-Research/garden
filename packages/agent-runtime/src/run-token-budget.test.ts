import { hasToolCall, streamText, tool } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  parsePersistedRunUsage,
  runTokenBudgetReached,
  runTokenBudgetStopCondition,
} from './run-token-budget'

const usage = (inputTotal: number, outputTotal: number) => ({
  inputTokens: {
    total: inputTotal,
    noCache: inputTotal,
    cacheRead: 0,
    cacheWrite: 0,
  },
  outputTokens: { total: outputTotal, text: outputTotal, reasoning: 0 },
})

/** A model that calls `work` on every step, 100 input + 50 output tokens each. */
function loopingModel() {
  let calls = 0
  const model = new MockLanguageModelV3({
    doStream: async () => {
      calls += 1
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] })
            controller.enqueue({
              type: 'tool-call',
              toolCallId: `call-${calls}`,
              toolName: 'work',
              input: '{}',
            })
            controller.enqueue({
              type: 'finish',
              finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
              usage: usage(100, 50),
            })
            controller.close()
          },
        }),
      }
    },
  })
  return { model, steps: () => calls }
}

const tools = {
  work: tool({
    inputSchema: z.object({}),
    execute: async () => 'done',
  }),
  finish: tool({
    inputSchema: z.object({}),
    execute: async () => 'finished',
  }),
}

async function drain(result: { fullStream: AsyncIterable<unknown> }) {
  for await (const _ of result.fullStream) {
    // consume
  }
}

describe('run token budget', () => {
  it('stops a tool loop once this turn reaches the budget', async () => {
    const { model, steps } = loopingModel()
    const result = streamText({
      model,
      prompt: 'go',
      tools,
      stopWhen: runTokenBudgetStopCondition({
        priorTurnTokens: 0,
        budget: 450,
      }),
    })
    await drain(result)

    expect(steps()).toBe(3)
  })

  it('counts tokens spent by earlier turns of the same run', async () => {
    const { model, steps } = loopingModel()
    const result = streamText({
      model,
      prompt: 'go',
      tools,
      stopWhen: runTokenBudgetStopCondition({
        priorTurnTokens: 300,
        budget: 450,
      }),
    })
    await drain(result)

    expect(steps()).toBe(1)
  })

  it('is not consulted when the model ends the turn on its own', async () => {
    let consulted = false
    const budget = runTokenBudgetStopCondition<typeof tools>({
      priorTurnTokens: 10_000,
      budget: 1,
    })
    const result = streamText({
      model: new MockLanguageModelV3({
        doStream: async () => ({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'stream-start', warnings: [] })
              controller.enqueue({ type: 'text-start', id: 't' })
              controller.enqueue({ type: 'text-delta', id: 't', delta: 'ok' })
              controller.enqueue({ type: 'text-end', id: 't' })
              controller.enqueue({
                type: 'finish',
                finishReason: { unified: 'stop', raw: 'stop' },
                usage: usage(100, 50),
              })
              controller.close()
            },
          }),
        }),
      }),
      prompt: 'go',
      tools,
      stopWhen: [
        hasToolCall('finish'),
        (options) => {
          consulted = true
          return budget(options)
        },
      ],
    })
    await drain(result)

    expect(consulted).toBe(false)
  })

  it('treats the budget as reached at exactly the limit', () => {
    expect(runTokenBudgetReached(449, 450)).toBe(false)
    expect(runTokenBudgetReached(450, 450)).toBe(true)
  })

  it('returns no usage for empty values and parses valid persisted usage', () => {
    const persisted = {
      input_tokens: 10,
      output_tokens: 5,
      cached_input_tokens: 0,
      total_tokens: 15,
      model: 'm',
      model_provider: 'p',
      step_count: 1,
      recorded_at_ms: 1,
    }
    expect(parsePersistedRunUsage(persisted)).toMatchObject({
      status: 'ok',
      value: persisted,
    })
    expect(parsePersistedRunUsage(null)).toMatchObject({
      status: 'ok',
      value: null,
    })
    expect(parsePersistedRunUsage(undefined)).toMatchObject({
      status: 'ok',
      value: null,
    })
  })

  it('rejects malformed persisted usage', () => {
    expect(parsePersistedRunUsage({ total_tokens: 'x' })).toMatchObject({
      status: 'error',
      error: {
        _tag: 'PersistedRunUsageInvalidError',
        issueSummary: expect.stringContaining('total_tokens'),
      },
    })
  })
})
