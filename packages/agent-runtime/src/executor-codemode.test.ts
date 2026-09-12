import { describe, expect, it } from 'vitest'
import {
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
    expect(
      extractExecutorToolRefs('tools.search("gmail invoice")'),
    ).toEqual([])
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
})
