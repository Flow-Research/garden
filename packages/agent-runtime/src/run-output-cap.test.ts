import { streamText } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { isOutputCapFinishReason } from './run-output-cap'

const usage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: 0,
    cacheWrite: 0,
  },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
}

function runStep(finishReason: 'length' | 'stop') {
  let calls = 0
  let stoppedByOutputCap = false
  const model = new MockLanguageModelV3({
    doStream: async () => {
      calls += 1
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] })
            controller.enqueue({ type: 'text-start', id: 'text' })
            controller.enqueue({
              type: 'text-delta',
              id: 'text',
              delta: 'partial answer',
            })
            controller.enqueue({ type: 'text-end', id: 'text' })
            controller.enqueue({
              type: 'finish',
              finishReason: { unified: finishReason, raw: finishReason },
              usage,
            })
            controller.close()
          },
        }),
      }
    },
  })
  const result = streamText({
    model,
    prompt: 'go',
    maxOutputTokens: 16_000,
    onStepFinish: ({ finishReason: stepFinishReason }) => {
      if (isOutputCapFinishReason(stepFinishReason)) {
        stoppedByOutputCap = true
      }
    },
  })

  return {
    calls: () => calls,
    result,
    stoppedByOutputCap: () => stoppedByOutputCap,
  }
}

async function drain(result: { fullStream: AsyncIterable<unknown> }) {
  for await (const _ of result.fullStream) {
    // consume
  }
}

describe('run output cap', () => {
  it('stops and flags a step that finishes with length', async () => {
    const run = runStep('length')
    await drain(run.result)

    expect(await run.result.finishReason).toBe('length')
    expect(run.calls()).toBe(1)
    expect(run.stoppedByOutputCap()).toBe(true)
  })

  it('does not flag a step that finishes normally', async () => {
    const run = runStep('stop')
    await drain(run.result)

    expect(await run.result.finishReason).toBe('stop')
    expect(run.calls()).toBe(1)
    expect(run.stoppedByOutputCap()).toBe(false)
  })
})
