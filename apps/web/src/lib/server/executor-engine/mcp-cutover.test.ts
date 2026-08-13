import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectFile = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8')

describe('Executor MCP one-Worker cutover', () => {
  it('uses public SDK/execution without the private Executor API host', () => {
    const source = projectFile('src/lib/server/executor-engine/mcp.ts')

    expect(source).toContain("from '@executor-js/sdk/core'")
    expect(source).toContain("from '@executor-js/execution/core'")
    expect(source).not.toMatch(/from ['"]@executor-js\/api/)
    expect(source).not.toContain('executor-connectors-service')
    expect(source).not.toContain('x-garden-identity')
  })

  it('binds both Durable Objects to the Garden Worker with a local migration', () => {
    const wrangler = projectFile('wrangler.jsonc')
    const server = projectFile('src/server.ts')

    expect(wrangler).toContain('"name": "EXECUTOR_MCP_SESSION"')
    expect(wrangler).toContain('"name": "EXECUTOR_MCP_EXECUTION_OWNER"')
    expect(wrangler).toContain('"tag": "v9"')
    expect(wrangler).not.toContain(
      '"script_name": "garden-executor-connectors"',
    )
    expect(server).toContain('ExecutorMcpSession')
    expect(server).toContain('ExecutorMcpExecutionOwnerDirectory')
  })

  it('keeps upstream cold-restore and hibernated stream preservation code', () => {
    const source = projectFile(
      '../../third_party/executor/packages/hosts/cloudflare/src/mcp/agent-session-durable-object.ts',
    )

    expect(source).toContain('const hasInMemoryRuntime =')
    expect(source).toContain('closeStreams: hasInMemoryRuntime')
    expect(source).toContain('restore_transport_runtime')
    expect(source).toContain('undelivered responses are')
    expect(source).toContain('persisted in durable storage and replayed')
  })

  it('never replaces a missing approval lease with a fresh deadline', () => {
    const source = projectFile(
      '../../third_party/executor/packages/hosts/cloudflare/src/mcp/agent-session-durable-object.ts',
    )
    const resumeApproval = source.slice(
      source.indexOf('async resumeExecutionForApproval('),
      source.indexOf('override async destroy()'),
    )

    expect(resumeApproval).toContain(
      'const deadline = yield* self.deadlineForExecution(executionId);',
    )
    expect(resumeApproval).toContain('if (!deadline) {')
    expect(resumeApproval).not.toContain('?? self.approvalDeadline()')
  })

  it('records one durable decision for concurrent approval requests', () => {
    const source = projectFile(
      '../../third_party/executor/packages/hosts/cloudflare/src/mcp/agent-session-durable-object.ts',
    )
    const recorder = source.slice(
      source.indexOf('private recordApprovalResponse('),
      source.indexOf('/** Prevents an approval'),
    )

    expect(recorder).toContain('self.ctx.storage.transaction')
    expect(recorder).toContain('approvalDecisionKey(executionId)')
    expect(recorder).toContain('if (existing)')
    expect(recorder).toContain('return recorded.response;')
  })
})
