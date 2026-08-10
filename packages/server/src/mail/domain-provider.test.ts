import { DomainName, ProviderObjectId } from '@garden/core/mail'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Redacted } from 'effect'
import * as HttpClient from 'effect/unstable/http/HttpClient'
import type * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse'
import {
  CloudflareDomainProviderConfig,
  cloudflareDomainProviderLayer,
} from './cloudflare-domain-provider.ts'
import {
  MailDomainProvider,
  MailDomainProviderNotFoundError,
  MailDomainProviderRejectedError,
  MailDomainProviderResponseError,
  MailDomainZoneId,
  MailWorkerName,
  testMailDomainProviderLayer,
} from './domain-provider.ts'

interface QueuedHttpResponse {
  readonly status?: number
  readonly body: unknown
}

/** Deterministic HTTP client that records post-transform requests in order. */
const recordingHttpClient = (responses: ReadonlyArray<QueuedHttpResponse>) => {
  const requests: Array<HttpClientRequest.HttpClientRequest> = []
  let responseIndex = 0
  const client = HttpClient.make((request) => {
    requests.push(request)
    const queued = responses[responseIndex]
    responseIndex += 1
    const selected = queued ?? {
      status: 500,
      body: {
        success: false,
        errors: [{ code: 1000, message: 'Unexpected request.' }],
        messages: [],
      },
    }
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify(selected.body), {
          status: selected.status ?? 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
  })

  return { client, requests }
}

/** Reads schema-encoded request JSON without weakening the body variant type. */
const requestBodyText = (
  request: HttpClientRequest.HttpClientRequest,
): string | undefined =>
  request.body._tag === 'Uint8Array'
    ? new TextDecoder().decode(request.body.body)
    : undefined

/** Keeps ordered request assertions explicit without unchecked indexing. */
const requestBodyAt = (
  requests: ReadonlyArray<HttpClientRequest.HttpClientRequest>,
  index: number,
): string | undefined => {
  const request = requests[index]
  return request === undefined ? undefined : requestBodyText(request)
}

const success = <A>(result: A) => ({
  success: true,
  errors: [],
  messages: [],
  result,
})

/** Supplies the adapter with isolated HTTP and redacted credential services. */
const cloudflareTestLayer = (client: HttpClient.HttpClient) =>
  cloudflareDomainProviderLayer.pipe(
    Layer.provide(
      Layer.succeed(
        CloudflareDomainProviderConfig,
        CloudflareDomainProviderConfig.of({
          apiBaseUrl: 'https://api.cloudflare.test/client/v4',
          apiToken: Redacted.make('secret-token'),
          accountId: 'account-1',
          workerName: MailWorkerName.make('garden-mail-worker'),
        }),
      ),
    ),
    Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
  )

describe('MailDomainProvider test layer', () => {
  it.effect('models deterministic provisioning, routing, and deletion', () =>
    Effect.gen(function* () {
      const provider = yield* MailDomainProvider
      const zoneId = MailDomainZoneId.make('zone-1')
      const name = DomainName.make('mail.example.com')
      const workerName = MailWorkerName.make('garden-mail-worker')

      const registered = yield* provider.registerSendingSubdomain({
        zoneId,
        name,
      })
      const registeredAgain = yield* provider.registerSendingSubdomain({
        zoneId,
        name,
      })
      expect(registeredAgain.providerDomainId).toBe(registered.providerDomainId)

      expect(
        yield* provider.inspectSendingSubdomain({
          zoneId,
          providerDomainId: registered.providerDomainId,
        }),
      ).toEqual(registered)

      const routing = yield* provider.enableEmailRouting({
        zoneId,
        domain: DomainName.make('example.com'),
      })
      expect(yield* provider.inspectEmailRouting({ zoneId })).toEqual(routing)

      expect(
        yield* provider.setCatchAllWorkerDelivery({ zoneId }),
      ).toMatchObject({ zoneId, workerName, enabled: true })

      yield* provider.deleteSendingSubdomain({
        zoneId,
        providerDomainId: registered.providerDomainId,
      })
      const missing = yield* provider
        .inspectSendingSubdomain({
          zoneId,
          providerDomainId: registered.providerDomainId,
        })
        .pipe(Effect.flip)
      expect(missing).toBeInstanceOf(MailDomainProviderNotFoundError)
    }).pipe(Effect.provide(testMailDomainProviderLayer)),
  )
})

describe('CloudflareDomainProvider', () => {
  it.effect(
    'uses the documented REST routes, bodies, and normalized results',
    () => {
      const sendingResult = {
        enabled: true,
        name: 'mail.example.com',
        tag: 'sending-1',
        created: '2026-08-10T10:00:00Z',
        modified: '2026-08-10T10:01:00Z',
        dkim_selector: 'cf2026',
        preview_enabled: false,
        return_path_domain: 'bounce.example.com',
      }
      const routingResult = {
        id: 'routing-1',
        enabled: true,
        name: 'example.com',
        created: '2026-08-10T10:02:00Z',
        modified: '2026-08-10T10:03:00Z',
        skip_wizard: false,
        status: 'misconfigured/locked',
        support_subaddress: true,
      }
      const fixture = recordingHttpClient([
        {
          body: success([
            { id: 'zone-123', name: 'example.com', status: 'active' },
          ]),
        },
        { body: success(sendingResult) },
        { body: success(sendingResult) },
        { body: { success: true, errors: [], messages: [] } },
        { body: success(routingResult) },
        { body: success(routingResult) },
        {
          body: success({
            id: 'catch-all-1',
            enabled: true,
            actions: [{ type: 'worker', value: ['garden-mail-worker'] }],
            matchers: [{ type: 'all' }],
            name: 'Garden Mail catch-all',
            source: 'api',
          }),
        },
      ])

      return Effect.gen(function* () {
        const provider = yield* MailDomainProvider
        const zoneId = MailDomainZoneId.make('zone-123')
        const providerDomainId = ProviderObjectId.make('sending-1')

        expect(
          yield* provider.resolveDomainZone({
            name: DomainName.make('example.com'),
          }),
        ).toMatchObject({ zoneId, name: 'example.com' })

        const registered = yield* provider.registerSendingSubdomain({
          zoneId,
          name: DomainName.make('mail.example.com'),
        })
        expect(registered).toMatchObject({
          provider: 'cloudflare-email-service',
          providerDomainId,
          dkimSelector: 'cf2026',
          returnPathDomain: 'bounce.example.com',
        })

        yield* provider.inspectSendingSubdomain({ zoneId, providerDomainId })
        yield* provider.deleteSendingSubdomain({ zoneId, providerDomainId })

        const enabled = yield* provider.enableEmailRouting({
          zoneId,
          domain: DomainName.make('example.com'),
        })
        expect(enabled.status).toBe('misconfigured_locked')
        expect(enabled.supportsSubaddressing).toBe(true)
        yield* provider.inspectEmailRouting({ zoneId })

        const catchAll = yield* provider.setCatchAllWorkerDelivery({ zoneId })
        expect(catchAll.providerRuleId).toBe('catch-all-1')

        expect(
          fixture.requests.map((request) => [request.method, request.url]),
        ).toEqual([
          ['GET', 'https://api.cloudflare.test/client/v4/zones'],
          [
            'POST',
            'https://api.cloudflare.test/client/v4/zones/zone-123/email/sending/subdomains',
          ],
          [
            'GET',
            'https://api.cloudflare.test/client/v4/zones/zone-123/email/sending/subdomains/sending-1',
          ],
          [
            'DELETE',
            'https://api.cloudflare.test/client/v4/zones/zone-123/email/sending/subdomains/sending-1',
          ],
          [
            'POST',
            'https://api.cloudflare.test/client/v4/zones/zone-123/email/routing/dns',
          ],
          [
            'GET',
            'https://api.cloudflare.test/client/v4/zones/zone-123/email/routing',
          ],
          [
            'PUT',
            'https://api.cloudflare.test/client/v4/zones/zone-123/email/routing/rules/catch_all',
          ],
        ])
        expect(fixture.requests[0]?.urlParams).toMatchObject({
          params: [
            ['account.id', 'account-1'],
            ['name', 'example.com'],
            ['status', 'active'],
            ['match', 'all'],
            ['per_page', '5'],
          ],
        })
        expect(fixture.requests[0]?.headers.authorization).toBe(
          'Bearer secret-token',
        )
        expect(requestBodyAt(fixture.requests, 1)).toBe(
          '{"name":"mail.example.com"}',
        )
        expect(requestBodyAt(fixture.requests, 4)).toBe(
          '{"name":"example.com"}',
        )
        expect(requestBodyAt(fixture.requests, 6)).toBe(
          '{"actions":[{"type":"worker","value":["garden-mail-worker"]}],"matchers":[{"type":"all"}],"enabled":true,"name":"Garden Mail catch-all","source":"api"}',
        )
      }).pipe(Effect.provide(cloudflareTestLayer(fixture.client)))
    },
  )

  it.effect(
    'preserves Cloudflare rejection diagnostics as a tagged error',
    () => {
      const fixture = recordingHttpClient([
        {
          status: 403,
          body: {
            success: false,
            errors: [{ code: 10000, message: 'Authentication failed.' }],
            messages: [],
          },
        },
      ])

      return Effect.gen(function* () {
        const provider = yield* MailDomainProvider
        const error = yield* provider
          .inspectEmailRouting({ zoneId: MailDomainZoneId.make('zone-123') })
          .pipe(Effect.flip)

        expect(error).toBeInstanceOf(MailDomainProviderRejectedError)
        expect(error).toMatchObject({
          operation: 'inspectEmailRouting',
          statusCode: 403,
          issues: [{ code: '10000', message: 'Authentication failed.' }],
        })
      }).pipe(Effect.provide(cloudflareTestLayer(fixture.client)))
    },
  )

  it.effect(
    'rejects a success envelope that omits its documented result',
    () => {
      const fixture = recordingHttpClient([
        { body: { success: true, errors: [], messages: [] } },
      ])

      return Effect.gen(function* () {
        const provider = yield* MailDomainProvider
        const error = yield* provider
          .inspectEmailRouting({ zoneId: MailDomainZoneId.make('zone-123') })
          .pipe(Effect.flip)

        expect(error).toBeInstanceOf(MailDomainProviderResponseError)
        expect(error).toMatchObject({
          operation: 'inspectEmailRouting',
          statusCode: 200,
        })
      }).pipe(Effect.provide(cloudflareTestLayer(fixture.client)))
    },
  )
})
