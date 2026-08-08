import { describe, expect, it } from '@effect/vitest'
import { Effect, Result } from 'effect'
import {
  decryptSecret,
  deriveKey,
  encryptSecret,
} from '@executor-js/plugin-encrypted-secrets'

describe('Executor encrypted secrets', () => {
  it.effect('round-trips the Workers-compatible base64 envelope', () =>
    Effect.gen(function* () {
      const key = deriveKey('garden-test-master-key')
      const encrypted = yield* encryptSecret(key, 'connector-secret')
      const decrypted = yield* decryptSecret(key, encrypted)

      expect(encrypted.split('.')).toHaveLength(4)
      expect(encrypted).not.toContain('connector-secret')
      expect(decrypted).toBe('connector-secret')
    }),
  )

  it.effect('rejects a wrong key through the typed storage error channel', () =>
    Effect.gen(function* () {
      const encrypted = yield* encryptSecret(
        deriveKey('garden-test-master-key'),
        'connector-secret',
      )
      const result = yield* Effect.result(
        decryptSecret(deriveKey('different-test-key'), encrypted),
      )

      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(result.failure._tag).toBe('StorageError')
      }
    }),
  )
})
