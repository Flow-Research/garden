import { describe, expect, it } from '@effect/vitest'
import { Effect, Predicate } from 'effect'
import {
  ConnectorError,
  ConnectorRateLimitError,
} from './errors.ts'

describe('ConnectorError', () => {
  it.effect('inherits shared connector error while preserving Effect tags', () =>
    Effect.gen(function* () {
      const failure = new ConnectorRateLimitError({
        connectorId: 'discord',
        operation: 'discord.readMessages',
        message: 'rate limited',
        retryAfterMs: 1_000,
      })

      expect(failure).toBeInstanceOf(ConnectorError)
      expect(Predicate.isTagged(failure, 'ConnectorRateLimitError')).toBe(true)

      const recovered = yield* Effect.gen(function* () {
        return yield* failure
      }).pipe(
        Effect.catchTag('ConnectorRateLimitError', (error) =>
          Effect.succeed(error.retryAfterMs),
        ),
      )

      expect(recovered).toBe(1_000)
    }),
  )
})
