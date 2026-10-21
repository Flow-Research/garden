import { describe, expect, it } from 'vitest'
import { Option, Schema } from 'effect'
import { discordNativeTools } from '../discord/tools.ts'
import { githubNativeTools } from '../github/tools.ts'

function tool<T extends { name: string }>(tools: readonly T[], name: string) {
  const found = tools.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`missing tool ${name}`)
  return found
}

function decodes(schema: Schema.Decoder<unknown>, value: unknown) {
  return Option.isSome(Schema.decodeUnknownOption(schema)(value))
}

describe('connector pagination inputs', () => {
  const searchCode = tool(githubNativeTools, 'search_code')
  const readMessages = tool(discordNativeTools, 'discord_read_messages')
  const searchMessages = tool(discordNativeTools, 'discord_search_messages')
  const searchInput = { owner: 'o', repo: 'r', query: 'q' }

  it('accepts integer page sizes within the provider limit', () => {
    expect(
      decodes(searchCode.input, { ...searchInput, page: 2, perPage: 100 }),
    ).toBe(true)
    expect(decodes(readMessages.input, { channelId: 'c', limit: 50 })).toBe(
      true,
    )
  })

  it('rejects fractional and out-of-range page sizes', () => {
    for (const perPage of [0, 1.5, 101]) {
      expect(decodes(searchCode.input, { ...searchInput, perPage })).toBe(false)
    }
    expect(decodes(readMessages.input, { channelId: 'c', limit: 500 })).toBe(
      false,
    )
    expect(
      decodes(searchMessages.input, { guildId: 'g', query: 'q', limit: 26 }),
    ).toBe(false)
  })

  it('advertises integer bounds in the tool JSON schema', () => {
    const schema = JSON.stringify(searchCode.inputSchema)
    expect(schema).toContain('"integer"')
    expect(schema).toContain('"maximum":100')
  })
})
