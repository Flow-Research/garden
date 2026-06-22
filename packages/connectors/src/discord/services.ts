import { Effect, Layer } from 'effect'
import { FetchHttpClient, HttpClient } from 'effect/unstable/http'
import { ConnectorConfigError } from '../effect/errors.ts'
import { DiscordRestClientLive } from './rest-client.ts'
import { DiscordBotConfig } from './rest-client.ts'

/**
 * Creates the per-runtime Discord bot configuration layer. The token is passed
 * in from the host boundary so Discord tools never read process env or Worker
 * bindings directly, matching Executor's service/layer style.
 */
export function makeDiscordBotConfigLayer(botToken: string) {
  const trimmed = botToken.trim()
  if (!trimmed) {
    return Layer.effect(
      DiscordBotConfig,
      Effect.fail(
        new ConnectorConfigError({
          connectorId: 'discord',
          operation: 'configure',
          message: 'Discord bot token is required',
        }),
      ),
    )
  }

  return Layer.succeed(DiscordBotConfig)({ botToken: trimmed })
}

/**
 * Provides Effect's fetch-backed HttpClient, optionally swapping global fetch
 * for deterministic unit tests. This keeps Discord on Effect Http instead of
 * raw `response.json()` / bare fetch promises.
 */
export function makeDiscordHttpClientLayer(fetch?: typeof globalThis.fetch) {
  return fetch
    ? FetchHttpClient.layer.pipe(
        Layer.provide(Layer.succeed(FetchHttpClient.Fetch)(fetch)),
      )
    : FetchHttpClient.layer
}

/** Combines host-provided Discord token, Effect HttpClient, and REST service. */
export function makeDiscordBaseLayer(args: {
  botToken: string
  fetch?: typeof globalThis.fetch
}) {
  const dependencies = Layer.mergeAll(
    makeDiscordBotConfigLayer(args.botToken),
    makeDiscordHttpClientLayer(args.fetch),
  )

  return DiscordRestClientLive.pipe(Layer.provide(dependencies))
}

/**
 * Builds a runtime layer only when the host has a token. Keeping this as an
 * Effect avoids optional env branches inside the connector implementation.
 */
export function discordBaseLayerFromOptionalToken(args: {
  botToken: string | undefined
  fetch?: typeof globalThis.fetch
}) {
  return args.botToken
    ? Effect.succeed(makeDiscordBaseLayer({ botToken: args.botToken, fetch: args.fetch }))
    : Effect.fail(
        new ConnectorConfigError({
          connectorId: 'discord',
          operation: 'configure',
          message: 'DISCORD_BOT_TOKEN is not configured',
        }),
      )
}

export type DiscordHttpClient = HttpClient.HttpClient
