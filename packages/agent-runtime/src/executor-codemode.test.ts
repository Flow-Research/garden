import { describe, expect, it } from 'vitest'
import {
  extractExecutorToolFailure,
  extractExecutorToolRefs,
  extractExecutorToolRefsFromInput,
  mentionsUnparsedExecutorTools,
} from './executor-codemode'

describe('extractExecutorToolRefs', () => {
  it('extracts dotted discovery tool names', () => {
    expect(
      extractExecutorToolRefs(
        'const t = await tools.google_gmail.user.gmail.gmail.users.messages.list({ userId: "me" })',
      ),
    ).toEqual([
      {
        executorSlug: 'google_gmail',
        owner: 'user',
        connection: 'gmail',
        tool: 'gmail.users.messages.list',
      },
    ])
  })

  it('dedupes repeated calls and collects multiple refs', () => {
    const code = [
      'await tools.google_gmail.user.gmail.gmail.users.messages.list({})',
      'await tools.google_gmail.user.gmail.gmail.users.messages.list({})',
      'await tools.slack.user.work.slack_conversations_list({})',
    ].join('\n')
    expect(extractExecutorToolRefs(code)).toEqual([
      {
        executorSlug: 'google_gmail',
        owner: 'user',
        connection: 'gmail',
        tool: 'gmail.users.messages.list',
      },
      {
        executorSlug: 'slack',
        owner: 'user',
        connection: 'work',
        tool: 'slack_conversations_list',
      },
    ])
  })

  it('returns empty for non-string input and unmatched code', () => {
    expect(extractExecutorToolRefs(undefined)).toEqual([])
    expect(extractExecutorToolRefs('const x = 1')).toEqual([])
    expect(extractExecutorToolRefs('tools.search("gmail invoice")')).toEqual([])
  })

  it('extracts from tool input objects', () => {
    expect(
      extractExecutorToolRefsFromInput({
        code: 'await tools.google_drive.user.docs.drive.files.list({})',
      }),
    ).toEqual([
      {
        executorSlug: 'google_drive',
        owner: 'user',
        connection: 'docs',
        tool: 'drive.files.list',
      },
    ])
    expect(extractExecutorToolRefsFromInput(null)).toEqual([])
  })

  it('flags tool mentions without parseable references', () => {
    expect(
      mentionsUnparsedExecutorTools(
        'return tools.google_gmail.search_messages(query="in:inbox")',
      ),
    ).toBe(true)
    expect(
      mentionsUnparsedExecutorTools(
        'await tools.google_gmail.user.gmail.gmail.users.messages.list({})',
      ),
    ).toBe(false)
    expect(mentionsUnparsedExecutorTools('const x = 1')).toBe(false)
    expect(mentionsUnparsedExecutorTools(null)).toBe(false)
  })

  it('preserves a Decide error and identifies the analysis stage', () => {
    expect(
      extractExecutorToolFailure({
        output: {
          isError: true,
          structuredContent: {
            status: 'error',
            error: 'Not enough Decide credits to run this request.',
            errorCode: 'insufficient_credits',
          },
          content: [
            {
              type: 'text',
              text: 'Not enough Decide credits to run this request.',
            },
          ],
        },
        toolName: 'executor_execute',
        toolInput: {
          code: 'await tools.decide.user.decide.analyze({ data: csv })',
        },
      }),
    ).toEqual({
      code: 'insufficient_credits',
      message: 'Not enough Decide credits to run this request.',
      kind: 'insufficient_credits',
      retryable: false,
      userAction: 'add_credits',
      stage: 'decide_analysis',
    })
  })

  it('keeps text blocks in order when the MCP envelope has no error field', () => {
    expect(
      extractExecutorToolFailure({
        output: {
          isError: true,
          content: [
            { type: 'text', text: 'First failure detail.' },
            { type: 'text', text: 'Second failure detail.' },
          ],
        },
        toolName: 'executor_execute',
      }),
    ).toEqual({
      message: 'First failure detail.\nSecond failure detail.',
      kind: 'provider_error',
      retryable: false,
      userAction: 'none',
      stage: 'mcp_handoff',
    })
  })

  it('extracts a provider error nested in a completed execution result', () => {
    expect(
      extractExecutorToolFailure({
        output: {
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
        },
        toolName: 'executor_execute',
        toolInput: {
          code: 'await tools.decide.user.decide.analyze({ data: csv })',
        },
      }),
    ).toEqual({
      code: 'mcp_tool_error',
      message: 'Not enough Decide credits to run this request.',
      kind: 'provider_error',
      retryable: false,
      userAction: 'none',
      stage: 'decide_analysis',
    })
  })

  it('classifies file-read and transport timeout failures', () => {
    expect(
      extractExecutorToolFailure({
        error: new Error('Document content could not be loaded.'),
        toolName: 'readDocument',
      }),
    ).toMatchObject({
      message: 'Document content could not be loaded.',
      stage: 'file_read',
    })
    expect(
      extractExecutorToolFailure({
        error: new Error('Decide analysis timed out after the deadline.'),
        toolName: 'executor_execute',
      }),
    ).toMatchObject({
      message: 'Decide analysis timed out after the deadline.',
      stage: 'transport_timeout',
    })
  })

  it('preserves safe structured transport details and uses the transport message', () => {
    expect(
      extractExecutorToolFailure({
        output: {
          isError: true,
          structuredContent: {
            status: 'error',
            error: {
              code: 'mcp_tool_error',
              message: 'MCP tool call failed for whoami',
              details: {
                status: 502,
                transportFailure: true,
                transportKind: 'http',
                transportMessage: 'MCP transport returned HTTP 502.',
              },
            },
          },
          content: [{ type: 'text', text: 'MCP tool call failed for whoami' }],
        },
        toolName: 'executor_execute',
        toolInput: {
          code: 'await tools.decide.user.decide.whoami({})',
        },
      }),
    ).toEqual({
      code: 'mcp_tool_error',
      message: 'MCP transport returned HTTP 502.',
      kind: 'transport',
      status: 502,
      transportKind: 'http',
      transportMessage: 'MCP transport returned HTTP 502.',
      retryable: false,
      userAction: 'none',
      stage: 'transport',
    })
  })
})
