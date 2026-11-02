import { ApiError } from '@/lib/api/errors'
import { describe, expect, it } from 'vitest'
import type { ChatUiMessage } from '../chat-runtime-provider'
import {
  buildMessageRenderModel,
  decideAnalysisRunId,
  decideAnalysisCardView,
  decideAnalysisStepView,
  decideFileKind,
  formatElapsed,
  extractMcpFailure,
  isInternalChatMessage,
  productToolLabel,
} from './chat-message-model'

describe('chat integration tool presentation', () => {
  it('uses a connector-neutral label for analysis', () => {
    expect(
      productToolLabel('tool_executor_execute', {
        code: 'await tools.decide.user.decide.analyze({ data })',
      }),
    ).toBe('Analyzing the data')
    expect(
      productToolLabel('tool_executor_decide_analyze', {
        question: 'Analyze this file.',
      }),
    ).toBe('Analyzing your data')
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

  it('preserves status and MCP code for the error detail', () => {
    expect(
      extractMcpFailure({
        isError: true,
        structuredContent: {
          status: 'error',
          failureStage: 'mcp_handoff',
          error: { message: 'MCP tool call failed for whoami.' },
          details: { status: 502, mcpCode: -32603 },
        },
      }),
    ).toEqual({
      message: 'MCP tool call failed for whoami.',
      stage: 'mcp_handoff',
      status: 502,
      mcpCode: -32603,
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

describe('background Decide analysis', () => {
  const RUN_ID = '2f9d1c66-9b5e-4c8e-9a51-0c7a3c3d7e10'
  const handoff = {
    id: `decide-analysis:${RUN_ID}:attempt:1`,
    role: 'user',
    metadata: { garden: { kind: 'decide_analysis_result', runId: RUN_ID } },
    parts: [{ type: 'text', text: 'Decide finished the analysis.' }],
  } as ChatUiMessage

  it('hides the internal result hand-off from the timeline', () => {
    const userAsk = {
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', text: 'Analyze revenue.' }],
    } as ChatUiMessage

    expect(isInternalChatMessage(handoff)).toBe(true)
    expect(isInternalChatMessage(userAsk)).toBe(false)
  })

  it('reads the run to poll from the analyze start result', () => {
    const output = {
      content: [{ type: 'text', text: 'The analysis is running.' }],
      structuredContent: { status: 'queued', run_id: RUN_ID },
    }

    expect(decideAnalysisRunId('tool_executor_decide_analyze', output)).toBe(
      RUN_ID,
    )
    expect(decideAnalysisRunId('tool_executor_execute', output)).toBeNull()
  })

  it('shows live progress and a cancel action until the run settles', () => {
    expect(decideAnalysisStepView('running', 'Reviewing revenue.')).toEqual({
      label: 'Analyzing your data…',
      detail: 'Reviewing revenue.',
      active: true,
      canCancel: true,
    })
    expect(decideAnalysisStepView('completed', 'ignored').label).toBe(
      'Analysis complete',
    )
    expect(decideAnalysisStepView('failed', null).label).toBe('Analysis failed')
    expect(decideAnalysisStepView('unavailable', null)).toEqual({
      label: 'Analysis failed',
      detail:
        'Garden could not load this analysis. Ask again to start a new one.',
      active: false,
      canCancel: false,
    })
    expect(decideAnalysisStepView('cancelled', null)).toMatchObject({
      label: 'Analysis cancelled',
      active: false,
      canCancel: false,
    })
  })
})

describe('Decide run in the message render model', () => {
  const RUN_ID = '2f9d1c66-9b5e-4c8e-9a51-0c7a3c3d7e10'
  const message = {
    id: 'a1',
    role: 'assistant',
    parts: [
      {
        type: 'tool-readDocument',
        toolCallId: 'call_read',
        state: 'output-available',
        input: { document_id: 'doc-1' },
        output: { ok: true },
      },
      {
        type: 'tool-tool_executor_decide_analyze',
        toolCallId: 'call_decide',
        state: 'output-available',
        input: { question: 'What drove revenue?' },
        output: {
          content: [{ type: 'text', text: 'The analysis is running.' }],
          structuredContent: { status: 'queued', run_id: RUN_ID },
        },
      },
    ],
  } as unknown as ChatUiMessage

  it('renders the run as its own card outside the collapsed work group', () => {
    const nodes = buildMessageRenderModel(message, { debugMode: false })

    expect(nodes.map((node) => node.kind)).toEqual(['work', 'decide'])
    const [work, decide] = nodes
    expect(work?.kind === 'work' && work.stepCount).toBe(1)
    expect(
      work?.kind === 'work' && work.entries.some((entry) => entry.decideRunId),
    ).toBe(false)
    expect(decide?.kind === 'decide' && decide.runId).toBe(RUN_ID)
  })
})

describe('Decide card helpers', () => {
  it('formats elapsed time the way a person reads it', () => {
    expect(formatElapsed(4_200)).toBe('4s')
    expect(formatElapsed(65_000)).toBe('1m 05s')
    expect(formatElapsed(-10)).toBe('0s')
  })

  it('previews images and labels other files by type', () => {
    expect(decideFileKind('chart.PNG')).toBe('image')
    expect(decideFileKind('photo.jpeg')).toBe('image')
    expect(decideFileKind('revenue.xlsx')).toBe('spreadsheet')
    expect(decideFileKind('rows.csv')).toBe('spreadsheet')
    expect(decideFileKind('report.pdf')).toBe('document')
    expect(decideFileKind('bundle.zip')).toBe('file')
  })
})

describe('Decide analysis card after a failed request', () => {
  const running = { status: 'running', progressMessage: null } as const

  it('settles as failed when the run cannot be loaded', () => {
    expect(
      decideAnalysisCardView({
        ...running,
        loadFailed: true,
        cancelError: null,
      }),
    ).toMatchObject({ label: 'Analysis failed', active: false })
  })

  it('stops the spinner when Cancel finds no run', () => {
    expect(
      decideAnalysisCardView({
        ...running,
        loadFailed: false,
        cancelError: new ApiError({
          message: 'Not found',
          status: 404,
          statusText: 'Not Found',
        }),
      }),
    ).toMatchObject({
      label: 'Analysis failed',
      active: false,
      canCancel: false,
    })
  })

  it('keeps the run live and says Cancel failed on any other error', () => {
    expect(
      decideAnalysisCardView({
        ...running,
        loadFailed: false,
        cancelError: new ApiError({
          message: 'Boom',
          status: 500,
          statusText: 'Server Error',
        }),
      }),
    ).toMatchObject({
      label: 'Analyzing your data…',
      detail: 'Garden could not cancel this analysis. Try again.',
      active: true,
      canCancel: true,
    })
  })
})
