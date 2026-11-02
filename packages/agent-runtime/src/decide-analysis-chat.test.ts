import { describe, expect, it } from 'vitest'
import type { StepResult, ToolSet, UIMessage } from 'ai'
import {
  DECIDE_ANALYZE_TOOL_KEY,
  decideAnalysisDeliveryMessage,
  isDecideAnalysisDeliveryTurn,
  isDecideToolKey,
  stopAfterDecideAnalysisStarts,
} from './decide-analysis-chat'

const RUN_ID = '2f9d1c66-9b5e-4c8e-9a51-0c7a3c3d7e10'

const stepWithToolCalls = (toolNames: string[]) =>
  ({
    toolCalls: toolNames.map((toolName, index) => ({
      type: 'tool-call',
      toolCallId: `call_${index}`,
      toolName,
      input: {},
    })),
  }) as unknown as StepResult<ToolSet>

const stops = (toolNames: string[]) =>
  stopAfterDecideAnalysisStarts({ steps: [stepWithToolCalls(toolNames)] })

const completedRun = {
  runId: RUN_ID,
  attempt: 2,
  status: 'completed',
  errorJson: null,
  resultJson: {
    content: [
      { type: 'text', text: 'Revenue grew 12.4% in Q3, led by EMEA.' },
      { type: 'text', text: 'Churn fell to 3.1%.' },
      {
        type: 'resource_link',
        name: 'revenue.xlsx',
        uri: 'https://api.trydecide.ai/uploads/revenue.xlsx',
      },
    ],
    structuredContent: { session_id: 'sess_secret' },
  },
}

describe('stopAfterDecideAnalysisStarts', () => {
  it('ends the turn after the step that started the analysis', async () => {
    expect(await stops([DECIDE_ANALYZE_TOOL_KEY])).toBe(true)
  })

  it('lets other tool steps continue', async () => {
    expect(await stops(['readDocument', 'tool_executor_execute'])).toBe(false)
  })
})

describe('decideAnalysisDeliveryMessage', () => {
  it('carries the findings in order and names the generated files', () => {
    const message = decideAnalysisDeliveryMessage(completedRun)
    const text = message?.parts
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join('')

    expect(message?.role).toBe('user')
    expect(text).toContain('Revenue grew 12.4% in Q3, led by EMEA.')
    expect(text?.indexOf('Revenue grew')).toBeLessThan(
      text?.indexOf('Churn fell') ?? -1,
    )
    expect(text).toContain('download cards:\n- revenue.xlsx')
    expect(text).not.toContain('sess_secret')
  })

  it('carries the safe error for a failed run', () => {
    const message = decideAnalysisDeliveryMessage({
      ...completedRun,
      status: 'failed',
      resultJson: null,
      errorJson: { code: 'provider_error', message: 'Not enough credits.' },
    })

    expect(JSON.stringify(message?.parts)).toContain('Not enough credits.')
  })

  it('delivers nothing for a cancelled run', () => {
    expect(
      decideAnalysisDeliveryMessage({ ...completedRun, status: 'cancelled' }),
    ).toBeNull()
  })

  // Think.submitMessages (@cloudflare/think 0.10.0) returns the existing
  // submission for a known idempotency key, so a stable ID per attempt is
  // what makes a replayed delivery run no second turn.
  it('keys a replay to the same submission and a retry to a new one', () => {
    const first = decideAnalysisDeliveryMessage(completedRun)?.id
    const replay = decideAnalysisDeliveryMessage(completedRun)?.id
    const nextAttempt = decideAnalysisDeliveryMessage({
      ...completedRun,
      attempt: 3,
    })?.id

    expect(replay).toBe(first)
    expect(nextAttempt).not.toBe(first)
  })
})

describe('delivery turn', () => {
  it('is recognised from the hand-off message, not ordinary user text', () => {
    const handoff = decideAnalysisDeliveryMessage(completedRun)
    if (!handoff) throw new Error('expected a hand-off message')
    const userAsk: UIMessage = {
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', text: 'decide_analysis_result' }],
    }

    expect(isDecideAnalysisDeliveryTurn([userAsk, handoff])).toBe(true)
    expect(isDecideAnalysisDeliveryTurn([handoff, userAsk])).toBe(false)
  })

  it('removes every Decide tool and keeps the rest', () => {
    const active = [
      DECIDE_ANALYZE_TOOL_KEY,
      'tool_executor_decide_list_generated_files',
      'tool_executor_execute',
      'readDocument',
    ]

    expect(active.filter((key) => !isDecideToolKey(key))).toEqual([
      'tool_executor_execute',
      'readDocument',
    ])
  })
})
