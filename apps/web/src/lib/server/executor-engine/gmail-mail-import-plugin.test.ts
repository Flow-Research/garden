import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import * as HttpClient from 'effect/unstable/http/HttpClient'
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse'
import {
  ConnectionName,
  IntegrationSlug,
  StorageError,
  type ConnectionRef,
} from '@executor-js/sdk/core'
import {
  GmailCredentialBridgeError,
  GOOGLE_GMAIL_INTEGRATION,
  makeGmailMailImportExtension,
} from './gmail-mail-import-plugin'

const personalConnection: ConnectionRef = {
  owner: 'user',
  integration: GOOGLE_GMAIL_INTEGRATION,
  name: ConnectionName.make('personal'),
}

const unusedHttpClientLayer = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make(() => Effect.dieMessage('Unexpected Gmail request')),
)

describe('Gmail mail import credential bridge', () => {
  it.effect(
    'scopes a personal Gmail token to the request without returning it',
    () => {
      const authorizationHeaders: string[] = []
      const httpClient = HttpClient.make((request) => {
        const authorization = request.headers.authorization
        if (authorization !== undefined) {
          authorizationHeaders.push(authorization)
        }
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response(
              JSON.stringify({
                emailAddress: 'person@example.com',
                messagesTotal: 1,
                threadsTotal: 1,
                historyId: '10',
              }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            ),
          ),
        )
      })
      const extension = makeGmailMailImportExtension({
        resolver: {
          resolveValue: () => Effect.succeed('secret-access-token'),
        },
        httpClientLayer: Layer.succeed(HttpClient.HttpClient, httpClient),
      })

      return Effect.gen(function* () {
        const result = yield* extension.withGmailClient(
          personalConnection,
          (client) => client.getProfile(),
        )
        expect(result.emailAddress).toBe('person@example.com')
        expect(authorizationHeaders).toEqual(['Bearer secret-access-token'])
        expect(JSON.stringify(result)).not.toContain('secret-access-token')
      })
    },
  )

  it.effect('rejects non-Gmail and workspace-owned connection refs', () => {
    let resolutions = 0
    const extension = makeGmailMailImportExtension({
      resolver: {
        resolveValue: () => {
          resolutions += 1
          return Effect.succeed('secret-access-token')
        },
      },
      httpClientLayer: unusedHttpClientLayer,
    })
    const nonGmail: ConnectionRef = {
      ...personalConnection,
      integration: IntegrationSlug.make('slack'),
    }
    const workspaceGmail: ConnectionRef = {
      ...personalConnection,
      owner: 'org',
    }

    return Effect.gen(function* () {
      const integrationError = yield* extension
        .withGmailClient(nonGmail, () => Effect.void)
        .pipe(Effect.flip)
      const ownerError = yield* extension
        .withGmailClient(workspaceGmail, () => Effect.void)
        .pipe(Effect.flip)

      expect(integrationError).toMatchObject({
        reason: 'unsupported_integration',
      })
      expect(ownerError).toMatchObject({ reason: 'unsupported_owner' })
      expect(resolutions).toBe(0)
    })
  })

  it.effect(
    'maps missing and failed credential resolution to safe errors',
    () => {
      const missing = makeGmailMailImportExtension({
        resolver: { resolveValue: () => Effect.succeed(null) },
        httpClientLayer: unusedHttpClientLayer,
      })
      const failed = makeGmailMailImportExtension({
        resolver: {
          resolveValue: () =>
            Effect.fail(
              new StorageError({
                message: 'provider storage failed',
                cause: new Error('private storage detail'),
              }),
            ),
        },
        httpClientLayer: unusedHttpClientLayer,
      })

      return Effect.gen(function* () {
        const missingError = yield* missing
          .withGmailClient(personalConnection, () => Effect.void)
          .pipe(Effect.flip)
        const resolutionError = yield* failed
          .withGmailClient(personalConnection, () => Effect.void)
          .pipe(Effect.flip)

        expect(missingError).toBeInstanceOf(GmailCredentialBridgeError)
        expect(missingError).toMatchObject({
          reason: 'credential_unavailable',
        })
        expect(resolutionError).toMatchObject({
          reason: 'credential_resolution_failed',
        })
        expect(resolutionError.message).not.toContain('private storage detail')
      })
    },
  )
})
