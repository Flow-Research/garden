import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { logPublicMcpProgress } from './plugins'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Executor MCP progress logging', () => {
  it('records public progress without recording private execution data', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    logPublicMcpProgress({
      progress: 2,
      total: 4,
      message: 'Running analysis with Decide',
    })

    expect(info.mock.calls[0]?.[0]).toMatchObject({
      event: 'mcp.integration.progress',
      progress: 2,
      total: 4,
      progressMessage: 'Running analysis with Decide',
    })
    expect(JSON.stringify(info.mock.calls)).not.toContain('CSV')
  })

  it('keeps provider JSON-RPC error messages in the patched MCP client', () => {
    const pluginEntry = fileURLToPath(
      import.meta.resolve('@executor-js/plugin-mcp/core'),
    )
    const mcpClientSource = readFileSync(
      resolve(dirname(pluginEntry), 'chunk-MMILW7SS.js'),
      'utf8',
    )

    expect(mcpClientSource).toContain(
      'message: protocolFailure ? cause.message : `MCP tool call failed for ${toolName}`',
    )
  })
})
