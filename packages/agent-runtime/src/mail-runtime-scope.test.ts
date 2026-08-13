import { describe, expect, it } from 'vitest'
import {
  clearPersistedInboxMcpServersBeforeRestore,
  mailExecutorScopeChanged,
  readMailExecutorConnectionNames,
  replaceMailExecutorConnectionNames,
} from './mail-runtime-scope'

const createStorage = (initialConnectionNames: string[]) => {
  const names = new Set(initialConnectionNames)
  return {
    exec(query: string, ...bindings: unknown[]) {
      if (query.startsWith('select')) {
        return [...names].sort().map((connection_name) => ({ connection_name }))
      }
      if (query.startsWith('delete')) names.clear()
      if (query.startsWith('insert')) names.add(String(bindings[0]))
      return []
    },
  } as unknown as Pick<SqlStorage, 'exec'>
}

describe('Inbox Executor connection scope persistence', () => {
  it('restores the old scope after a failed reload so the retry reloads', () => {
    const storage = createStorage(['gmail-old'])
    const previous = readMailExecutorConnectionNames(storage)

    replaceMailExecutorConnectionNames(storage, ['gmail-new'])
    replaceMailExecutorConnectionNames(storage, previous)

    const persisted = readMailExecutorConnectionNames(storage)
    expect(persisted).toEqual(['gmail-old'])
    expect(mailExecutorScopeChanged(persisted, ['gmail-new'])).toBe(true)
  })

  it('deletes even a route-matching Executor row before SDK restoration', () => {
    const rows = new Map([
      [
        'executor',
        {
          id: 'executor',
          server_url: 'rpc:garden-mail-runtime-1',
          server_options: JSON.stringify({
            bindingName: 'EXECUTOR_MCP_SESSION',
            props: { session: { resource: { kind: 'toolkit' } } },
          }),
        },
      ],
    ])
    const storage = {
      exec(query: string) {
        if (query === 'delete from cf_agents_mcp_servers') rows.clear()
        return []
      },
    } as unknown as Pick<SqlStorage, 'exec'>

    clearPersistedInboxMcpServersBeforeRestore(storage)

    expect(rows.size).toBe(0)
  })
})
