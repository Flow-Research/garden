import { describe, expect, it } from '@effect/vitest'
import { Effect, Predicate } from 'effect'
import {
  ConnectorPermissionError,
  ConnectorRateLimitError,
} from '../effect/errors.ts'
import { makeDiscordBaseLayer } from './services.ts'
import { DiscordRestClient } from './rest-client.ts'

const discordMessage = {
  id: 'm1',
  channel_id: 'c1',
  content: 'sent',
  timestamp: '2026-06-21T00:00:00.000Z',
  author: {
    id: 'u1',
    username: 'garden',
    bot: true,
  },
}

/** Runs a Discord client program against a deterministic Effect Http fetch. */
function withDiscordTestLayer<A>(
  fetch: typeof globalThis.fetch,
  program: Effect.Effect<A, unknown, DiscordRestClient>,
  guildId?: string,
) {
  return program.pipe(
    Effect.provide(
      makeDiscordBaseLayer({ botToken: 'bot-token', guildId, fetch }),
    ),
  )
}

describe('DiscordRestClient', () => {
  it.effect('maps Discord rate limits into shared connector errors', () =>
    Effect.gen(function* () {
      const fetch: typeof globalThis.fetch = (async () =>
        new Response('{"message":"rate limited"}', {
          status: 429,
          headers: {
            'content-type': 'application/json',
            'retry-after': '2',
          },
        })) as typeof globalThis.fetch

      const error = yield* withDiscordTestLayer(
        fetch,
        Effect.gen(function* () {
          const client = yield* DiscordRestClient
          return yield* client.listChannels('g1')
        }),
      ).pipe(Effect.flip)

      expect(Predicate.isTagged(error, 'ConnectorRateLimitError')).toBe(true)
      const rateLimit = error as ConnectorRateLimitError
      expect(rateLimit.connectorId).toBe('discord')
      expect(rateLimit.retryAfterMs).toBe(2_000)
    }),
  )

  it.effect('sends authenticated JSON', () =>
    Effect.gen(function* () {
      const seen: Array<{
        url: string
        method: string | undefined
        authorization: string | null
        body: string | null
      }> = []
      const fetch: typeof globalThis.fetch = (async (input, init) => {
        const bodyText = init?.body
          ? new TextDecoder().decode(init.body as Uint8Array)
          : ''
        seen.push({
          url: String(input),
          method: init?.method,
          authorization: new Headers(init?.headers).get('authorization'),
          body: bodyText || null,
        })
        return new Response(JSON.stringify(discordMessage), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }) as typeof globalThis.fetch

      const result = yield* withDiscordTestLayer(
        fetch,
        Effect.gen(function* () {
          const client = yield* DiscordRestClient
          return yield* client.sendMessage({
            channelId: 'c1',
            content: 'hello',
          })
        }),
      )

      expect(result.id).toBe('m1')
      expect(seen).toEqual([
        {
          url: 'https://discord.com/api/v10/channels/c1/messages',
          method: 'POST',
          authorization: 'Bot bot-token',
          body: '{"content":"hello"}',
        },
      ])
    }),
  )

  it.effect('returns only the authorized server', () =>
    Effect.gen(function* () {
      const urls: string[] = []
      const fetch: typeof globalThis.fetch = (async (input) => {
        urls.push(String(input))
        return new Response(JSON.stringify({ id: 'g1', name: 'Garden' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }) as typeof globalThis.fetch

      const servers = yield* withDiscordTestLayer(
        fetch,
        Effect.gen(function* () {
          const client = yield* DiscordRestClient
          return yield* client.listServers()
        }),
        'g1',
      )

      expect(servers.map((server) => server.id)).toEqual(['g1'])
      expect(urls).toEqual(['https://discord.com/api/v10/guilds/g1'])
    }),
  )

  it.effect('blocks out-of-scope channels', () =>
    Effect.gen(function* () {
      const urls: string[] = []
      const fetch: typeof globalThis.fetch = (async (input) => {
        urls.push(String(input))
        return new Response(
          JSON.stringify({ id: 'c2', type: 0, guild_id: 'g2' }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        )
      }) as typeof globalThis.fetch

      const error = yield* withDiscordTestLayer(
        fetch,
        Effect.gen(function* () {
          const client = yield* DiscordRestClient
          return yield* client.sendMessage({
            channelId: 'c2',
            content: 'blocked',
          })
        }),
        'g1',
      ).pipe(Effect.flip)

      expect(Predicate.isTagged(error, 'ConnectorPermissionError')).toBe(true)
      expect((error as ConnectorPermissionError).operation).toBe(
        'discord.sendMessage',
      )
      expect(urls).toEqual(['https://discord.com/api/v10/channels/c2'])
    }),
  )
})
