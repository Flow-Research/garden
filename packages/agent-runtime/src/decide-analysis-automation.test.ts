import { describe, expect, it } from 'vitest'
import type { StepResult, ToolSet } from 'ai'
import { DECIDE_ANALYZE_TOOL_KEY } from './decide-analysis-chat'
import {
  decideAnalysisAutomationResumeText,
  stopAfterAutomationDecideAnalysisStarts,
} from './decide-analysis-automation'

const stepWithToolResult = (toolName: string, output: unknown) =>
  ({
    toolResults: [
      { type: 'tool-result', toolCallId: 'call_0', toolName, output },
    ],
  }) as unknown as StepResult<ToolSet>

const stops = (toolName: string, output: unknown) =>
  stopAfterAutomationDecideAnalysisStarts({
    steps: [stepWithToolResult(toolName, output)],
  })

describe('stopAfterAutomationDecideAnalysisStarts', () => {
  it('ends the turn once Decide accepted the run', async () => {
    expect(
      await stops(DECIDE_ANALYZE_TOOL_KEY, {
        content: [{ type: 'text', text: 'started' }],
        structuredContent: { status: 'queued', run_id: 'decide-1' },
      }),
    ).toBe(true)
  })

  it('keeps the turn going when the start was refused', async () => {
    expect(
      await stops(DECIDE_ANALYZE_TOOL_KEY, {
        isError: true,
        content: [{ type: 'text', text: 'The data is larger than 100 MB.' }],
        structuredContent: { status: 'error' },
      }),
    ).toBe(false)
  })

  it('ignores other tools', async () => {
    expect(
      await stops('tool_executor_execute', {
        structuredContent: { run_id: 'x' },
      }),
    ).toBe(false)
  })
})

const completedRun = {
  status: 'completed',
  errorJson: null,
  resultJson: {
    content: [
      { type: 'text', text: 'EMEA grew fastest at 12.4%.' },
      {
        type: 'resource_link',
        name: 'regions.xlsx',
        uri: 'https://api.trydecide.ai/outputs/regions.xlsx',
      },
    ],
  },
}

describe('decideAnalysisAutomationResumeText', () => {
  it('hands over the findings and the file links for the report', () => {
    const text = decideAnalysisAutomationResumeText(completedRun)

    expect(text).toContain('EMEA grew fastest at 12.4%.')
    expect(text).toContain(
      '- regions.xlsx: https://api.trydecide.ai/outputs/regions.xlsx',
    )
    expect(text).toContain('complete_automation')
  })

  it('hands over the failure reason as written', () => {
    const text = decideAnalysisAutomationResumeText({
      status: 'failed',
      resultJson: null,
      errorJson: { code: 'provider_error', message: 'Out of Decide credits.' },
    })

    expect(text).toContain('Out of Decide credits.')
    expect(text).not.toContain('<decide_output>')
  })

  it('says the analysis was cancelled', () => {
    expect(
      decideAnalysisAutomationResumeText({
        status: 'cancelled',
        resultJson: null,
        errorJson: null,
      }),
    ).toContain('cancelled')
  })

  it('says Garden stopped waiting when Decide never reported back', () => {
    expect(
      decideAnalysisAutomationResumeText({
        status: 'running',
        resultJson: null,
        errorJson: null,
      }),
    ).toContain('stopped waiting')
  })
})
