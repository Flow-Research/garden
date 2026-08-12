import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { extractThreadIdFromAgentName } from './mcp-connectors'
import { findThreadRuntimeIdentity } from './runtime-mcp-controller'

describe('Runtime MCP thread identity', () => {
  it('resolves a facet runtime-key host name to the canonical thread id', async () => {
    const runtimeKey = '230944ad-4e62-4e2f-a9ad-f5c31fb69966'
    const runtimeRef = extractThreadIdFromAgentName(`chat:${runtimeKey}`)
    expect(runtimeRef).toBe(runtimeKey)

    const identity = await findThreadRuntimeIdentity(
      runtimeRef!,
      async (condition) => {
        const query = new PgDialect().sqlToQuery(condition)

        expect(query.sql).toContain('"chat_thread"."id" = $1')
        expect(query.sql).toContain('"chat_thread"."runtime_key" = $2')
        expect(query.params).toEqual([runtimeKey, runtimeKey])

        return [
          {
            threadId: '0e560462-fbe0-5df6-8cad-4f435194ce93',
            workspaceId: 'workspace-1',
            userId: 'user-1',
            agentId: 'agent-1',
          },
        ]
      },
    )

    expect(identity).toEqual({
      threadId: '0e560462-fbe0-5df6-8cad-4f435194ce93',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      agentId: 'agent-1',
    })
  })
})
