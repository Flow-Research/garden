import { describe, expect, it, vi } from 'vitest'
import { executeRegisteredClientTool } from './chat-runtime-provider'

describe('client chat tools', () => {
  it('executes a registered browser action and returns its output', async () => {
    const addToolOutput = vi.fn()
    await executeRegisteredClientTool({
      tools: {
        compose_mail: {
          execute: async () => ({ status: 'opened' }),
        },
      },
      toolCall: {
        toolCallId: 'tool-call-1',
        toolName: 'compose_mail',
        input: { body: 'Hello' },
      },
      addToolOutput,
    })

    expect(addToolOutput).toHaveBeenCalledWith({
      toolCallId: 'tool-call-1',
      output: { status: 'opened' },
    })
  })

  it('returns a safe error when a browser action fails', async () => {
    const addToolOutput = vi.fn()
    await executeRegisteredClientTool({
      tools: {
        compose_mail: {
          execute: async () => {
            throw new Error('sensitive backend detail')
          },
        },
      },
      toolCall: {
        toolCallId: 'tool-call-2',
        toolName: 'compose_mail',
        input: {},
      },
      addToolOutput,
    })

    expect(addToolOutput).toHaveBeenCalledWith({
      toolCallId: 'tool-call-2',
      state: 'output-error',
      errorText: 'Garden could not complete this action.',
    })
  })
})
