// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { EXECUTOR_MCP_RPC_TIMEOUT_MS } from './mcp-timeout-config'

const mcpSource = readFileSync(
  fileURLToPath(new URL('./mcp.ts', import.meta.url)),
  'utf8',
)

describe('Executor MCP transport timeout', () => {
  it('extends past Decide’s documented four-minute analysis window', () => {
    expect(EXECUTOR_MCP_RPC_TIMEOUT_MS).toBeGreaterThan(4 * 60 * 1000)
    expect(EXECUTOR_MCP_RPC_TIMEOUT_MS).toBe(4 * 60 * 1000 + 30 * 1000)
  })

  it('uses the value on the Executor MCP session transport', () => {
    expect(mcpSource).toContain('protected override getRpcTransportOptions()')
    expect(mcpSource).toContain('timeout: EXECUTOR_MCP_RPC_TIMEOUT_MS')
  })
})
