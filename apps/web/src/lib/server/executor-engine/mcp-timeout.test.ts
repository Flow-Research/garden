import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { EXECUTOR_MCP_RPC_TIMEOUT_MS } from './mcp-timeout-config'

const mcpSource = readFileSync(
  resolve(process.cwd(), 'apps/web/src/lib/server/executor-engine/mcp.ts'),
  'utf8',
)

describe('Executor MCP transport timeout', () => {
  it('matches Decide’s documented four-minute analysis window', () => {
    expect(EXECUTOR_MCP_RPC_TIMEOUT_MS).toBe(4 * 60 * 1000)
  })

  it('uses the value on the Executor MCP session transport', () => {
    expect(mcpSource).toContain('protected override getRpcTransportOptions()')
    expect(mcpSource).toContain('timeout: EXECUTOR_MCP_RPC_TIMEOUT_MS')
  })
})
