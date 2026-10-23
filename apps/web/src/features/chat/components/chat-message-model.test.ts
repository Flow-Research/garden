import { describe, expect, it } from 'vitest'
import { extractMcpFailure, productToolLabel } from './chat-message-model'

describe('chat integration tool presentation', () => {
  it('uses a human label for Decide analysis', () => {
    expect(
      productToolLabel('tool_executor_execute', {
        code: 'await tools.decide.user.decide.analyze({ data })',
      }),
    ).toBe('Running analysis with Decide')
    expect(
      productToolLabel('tool_executor_decide_analyze', {
        question: 'Analyze this file.',
      }),
    ).toBe('Running analysis with Decide')
  })

  it('shows the exact MCP error and failure stage', () => {
    expect(
      extractMcpFailure({
        isError: true,
        structuredContent: {
          status: 'error',
          failureStage: 'transport_timeout',
          error: 'Decide analysis timed out after four minutes.',
        },
      }),
    ).toEqual({
      message: 'Decide analysis timed out after four minutes.',
      stage: 'transport_timeout',
    })
  })

  it('preserves multiple text blocks, including generated report links', () => {
    expect(
      extractMcpFailure({
        isError: true,
        content: [
          { type: 'text', text: 'Analysis failed.' },
          { type: 'text', text: 'Report: https://example.com/report.xlsx' },
        ],
      }),
    ).toEqual({
      message: 'Analysis failed.\nReport: https://example.com/report.xlsx',
      stage: undefined,
    })
  })

  it('shows a provider error nested in a completed Executor result', () => {
    expect(
      extractMcpFailure({
        structuredContent: {
          status: 'completed',
          result: {
            ok: false,
            error: {
              code: 'mcp_tool_error',
              message: 'Not enough Decide credits to run this request.',
            },
          },
        },
      }),
    ).toEqual({
      message: 'Not enough Decide credits to run this request.',
      stage: undefined,
    })
  })
})
