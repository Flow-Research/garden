import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./agent-do.ts', import.meta.url), 'utf8')
const chatSubAgentSource = source.slice(
  source.indexOf('export class ChatSubAgent'),
)

describe('ChatSubAgent security contract', () => {
  it('prunes MCP rows outside the facet-specific Executor route before restore', () => {
    const constructorIndex = chatSubAgentSource.indexOf(
      'constructor(ctx: DurableObjectState',
    )
    const onErrorIndex = chatSubAgentSource.indexOf('override onError')
    const constructorSource = chatSubAgentSource.slice(
      constructorIndex,
      onErrorIndex,
    )

    expect(constructorSource).toContain(
      'pruneInboxMcpServers(this.ctx.storage)',
    )
    expect(source).toContain('executorMcpServerNameForResource({')
    expect(source).toContain('where id <> ? or server_url <> ?')
    expect(source).toContain('bindingName !== EXECUTOR_MCP_BINDING_NAME')
  })

  it('never streams model reasoning into Garden chat UI', () => {
    expect(chatSubAgentSource).toContain('sendReasoning: false')
    expect(chatSubAgentSource).not.toContain('sendReasoning: true')
  })

  it('binds Inbox authority outside client-writable Agent state', () => {
    expect(chatSubAgentSource).not.toContain('initialState')
    expect(chatSubAgentSource).not.toContain('setState(')
    expect(chatSubAgentSource).toContain('mail_context_token')
    expect(chatSubAgentSource).toContain('rowsWritten !== 1')
    expect(chatSubAgentSource).toContain('override async onChatRecovery')
  })

  it('revalidates exact conversation ownership before consuming a turn', () => {
    expect(chatSubAgentSource).toContain(
      'eq(schema.mailConversation.id, context.conversationId)',
    )
    expect(chatSubAgentSource).toContain(
      'eq(schema.mailConversation.workspaceId, context.workspaceId)',
    )
    expect(chatSubAgentSource).toContain(
      'eq(schema.mailConversation.mailboxId, context.mailboxId)',
    )
  })

  it('treats selected mail as context without restricting authorized mailbox search', () => {
    expect(chatSubAgentSource).toContain(
      'Treat it as the referent for “this email”, while keeping every jointly authorized mailbox available for explicit search and read requests.',
    )
    expect(chatSubAgentSource).not.toContain(
      'This turn is restricted to that exact conversation.',
    )
  })
})
