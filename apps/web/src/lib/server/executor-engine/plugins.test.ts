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
})
