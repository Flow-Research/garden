import {
  DomainName,
  ProviderKey,
  ProviderObjectId,
  UtcTimestamp,
} from '@garden/core/mail'
import { Config, Context, Effect, Layer, Redacted, Schema } from 'effect'
import * as HttpClient from 'effect/unstable/http/HttpClient'
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse'
import type {
  CatchAllWorkerDelivery,
  EmailRoutingState,
  EnableEmailRoutingInput,
  InspectEmailRoutingInput,
  ProvisionedSendingSubdomain,
  ResolveMailDomainZoneInput,
  ResolvedMailDomainZone,
  SendingSubdomainReference,
  SendingSubdomainRegistration,
  SetCatchAllWorkerDeliveryInput,
} from './domain-provider.ts'
import {
  MailDomainProvider,
  MailDomainProviderNotFoundError,
  MailDomainProviderRejectedError,
  MailDomainProviderRequestError,
  MailDomainProviderResponseError,
  MailDomainZoneId,
  MailWorkerName,
} from './domain-provider.ts'

const CLOUDFLARE_PROVIDER = ProviderKey.make('cloudflare-email-service')
const DEFAULT_API_BASE_URL = 'https://api.cloudflare.com/client/v4'

export interface CloudflareDomainProviderConfigService {
  readonly apiBaseUrl: string
  readonly apiToken: Redacted.Redacted<string>
  readonly accountId: string
  readonly workerName: MailWorkerName
}

/** Runtime configuration kept separate from the provider and HTTP services. */
export class CloudflareDomainProviderConfig extends Context.Service<
  CloudflareDomainProviderConfig,
  CloudflareDomainProviderConfigService
>()('@garden/server/CloudflareDomainProviderConfig') {}

/** Loads credentials without exposing the token as an ordinary string. */
export const cloudflareDomainProviderConfigLayer = Layer.effect(
  CloudflareDomainProviderConfig,
  Effect.gen(function* () {
    const apiBaseUrl = yield* Config.string(
      'CLOUDFLARE_MAIL_API_BASE_URL',
    ).pipe(Config.withDefault(DEFAULT_API_BASE_URL))
    const apiToken = yield* Config.redacted('CLOUDFLARE_MAIL_API_TOKEN')
    const accountId = yield* Config.nonEmptyString('CLOUDFLARE_ACCOUNT_ID')
    const workerName = MailWorkerName.make(
      yield* Config.nonEmptyString('CLOUDFLARE_MAIL_WORKER_NAME'),
    )
    return CloudflareDomainProviderConfig.of({
      apiBaseUrl,
      apiToken,
      accountId,
      workerName,
    })
  }),
)

const CloudflareApiIssue = Schema.Struct({
  code: Schema.Int,
  message: Schema.String,
  documentation_url: Schema.optionalKey(Schema.String),
  source: Schema.optionalKey(
    Schema.Struct({ pointer: Schema.optionalKey(Schema.String) }),
  ),
})
interface CloudflareApiIssue extends Schema.Schema.Type<
  typeof CloudflareApiIssue
> {}

const cloudflareEnvelopeFields = {
  success: Schema.Boolean,
  errors: Schema.Array(CloudflareApiIssue),
  messages: Schema.Array(CloudflareApiIssue),
}

/** Minimal exact zone shape returned by Cloudflare's account-scoped list API. */
const CloudflareZone = Schema.Struct({
  id: MailDomainZoneId,
  name: DomainName,
  status: Schema.Literals(['active']),
})

const CloudflareZoneListEnvelope = Schema.Struct({
  ...cloudflareEnvelopeFields,
  result: Schema.optionalKey(Schema.Array(CloudflareZone)),
})

/**
 * Mirrors the documented Email Sending subdomain response. Required and
 * optional fields follow Cloudflare's live API reference as of 2026-08-10.
 * @see https://developers.cloudflare.com/api/resources/email_sending/subresources/subdomains/methods/get/
 */
const CloudflareSendingSubdomain = Schema.Struct({
  enabled: Schema.Boolean,
  name: DomainName,
  tag: ProviderObjectId,
  created: Schema.optionalKey(UtcTimestamp),
  dkim_selector: Schema.optionalKey(Schema.String),
  modified: Schema.optionalKey(UtcTimestamp),
  preview_enabled: Schema.optionalKey(Schema.Boolean),
  return_path_domain: Schema.optionalKey(DomainName),
})
interface CloudflareSendingSubdomain extends Schema.Schema.Type<
  typeof CloudflareSendingSubdomain
> {}

const CloudflareSendingSubdomainEnvelope = Schema.Struct({
  ...cloudflareEnvelopeFields,
  result: Schema.optionalKey(CloudflareSendingSubdomain),
})

const CloudflareDeleteEnvelope = Schema.Struct(cloudflareEnvelopeFields)

const CloudflareRoutingStatus = Schema.Literals([
  'ready',
  'unconfigured',
  'misconfigured',
  'misconfigured/locked',
  'unlocked',
])

/**
 * Mirrors Email Routing settings returned by both DNS enablement and inspect.
 * @see https://developers.cloudflare.com/api/resources/email_routing/subresources/dns/methods/create/
 */
const CloudflareEmailRoutingSettings = Schema.Struct({
  id: ProviderObjectId,
  enabled: Schema.Boolean,
  name: DomainName,
  created: Schema.optionalKey(UtcTimestamp),
  modified: Schema.optionalKey(UtcTimestamp),
  skip_wizard: Schema.optionalKey(Schema.Boolean),
  status: Schema.optionalKey(CloudflareRoutingStatus),
  support_subaddress: Schema.optionalKey(Schema.Boolean),
  tag: Schema.optionalKey(Schema.String),
})
interface CloudflareEmailRoutingSettings extends Schema.Schema.Type<
  typeof CloudflareEmailRoutingSettings
> {}

const CloudflareEmailRoutingEnvelope = Schema.Struct({
  ...cloudflareEnvelopeFields,
  result: Schema.optionalKey(CloudflareEmailRoutingSettings),
})

const CloudflareCatchAllAction = Schema.Struct({
  type: Schema.Literals(['drop', 'forward', 'worker']),
  value: Schema.optionalKey(Schema.Array(Schema.String)),
})

const CloudflareCatchAllMatcher = Schema.Struct({
  type: Schema.Literals(['all']),
})

/**
 * Cloudflare documents every catch-all result property as optional, so the
 * adapter validates the subset required to confirm Worker delivery afterward.
 * @see https://developers.cloudflare.com/api/resources/email_routing/subresources/rules/subresources/catch_alls/methods/update/
 */
const CloudflareCatchAllRule = Schema.Struct({
  id: Schema.optionalKey(ProviderObjectId),
  actions: Schema.optionalKey(Schema.Array(CloudflareCatchAllAction)),
  enabled: Schema.optionalKey(Schema.Boolean),
  matchers: Schema.optionalKey(Schema.Array(CloudflareCatchAllMatcher)),
  name: Schema.optionalKey(Schema.String),
  source: Schema.optionalKey(Schema.Literals(['api', 'wrangler'])),
  tag: Schema.optionalKey(Schema.String),
})
interface CloudflareCatchAllRule extends Schema.Schema.Type<
  typeof CloudflareCatchAllRule
> {}

const CloudflareCatchAllEnvelope = Schema.Struct({
  ...cloudflareEnvelopeFields,
  result: Schema.optionalKey(CloudflareCatchAllRule),
})

const CreateSendingSubdomainBody = Schema.Struct({ name: DomainName })
const EnableEmailRoutingBody = Schema.Struct({ name: DomainName })
const SetCatchAllWorkerBody = Schema.Struct({
  actions: Schema.Array(
    Schema.Struct({
      type: Schema.Literals(['worker']),
      value: Schema.Array(MailWorkerName),
    }),
  ),
  matchers: Schema.Array(CloudflareCatchAllMatcher),
  enabled: Schema.Boolean,
  name: Schema.String,
  source: Schema.Literals(['api']),
})

interface CloudflareEnvelope {
  readonly success: boolean
  readonly errors: ReadonlyArray<CloudflareApiIssue>
  readonly messages: ReadonlyArray<CloudflareApiIssue>
}

type Operation =
  | 'resolveDomainZone'
  | 'registerSendingSubdomain'
  | 'inspectSendingSubdomain'
  | 'deleteSendingSubdomain'
  | 'enableEmailRouting'
  | 'inspectEmailRouting'
  | 'setCatchAllWorkerDelivery'

/** Maps Cloudflare's numeric diagnostics into the provider-neutral error DTO. */
const providerIssues = (
  envelope: CloudflareEnvelope,
): ReadonlyArray<{ readonly code: string; readonly message: string }> =>
  [...envelope.errors, ...envelope.messages].map((issue) => ({
    code: String(issue.code),
    message: issue.message,
  }))

/** Rejects unsuccessful HTTP/API envelopes without leaking provider payloads. */
const ensureAccepted = <A extends CloudflareEnvelope>(
  operation: Operation,
  statusCode: number,
  envelope: A,
): Effect.Effect<A, MailDomainProviderRejectedError> => {
  if (statusCode >= 200 && statusCode < 300 && envelope.success) {
    return Effect.succeed(envelope)
  }

  const issues = providerIssues(envelope)
  return Effect.fail(
    new MailDomainProviderRejectedError({
      provider: CLOUDFLARE_PROVIDER,
      operation,
      statusCode,
      issues,
      message:
        issues[0]?.message ?? 'Cloudflare rejected the mail-domain operation.',
    }),
  )
}

/** Converts request-body encoding and HTTP failures at the adapter boundary. */
const executeRequest = <R>(
  client: HttpClient.HttpClient,
  operation: Operation,
  request: Effect.Effect<HttpClientRequest.HttpClientRequest, unknown, R>,
): Effect.Effect<
  HttpClientResponse.HttpClientResponse,
  MailDomainProviderRequestError,
  R
> =>
  request.pipe(
    Effect.mapError(
      (cause) =>
        new MailDomainProviderRequestError({
          provider: CLOUDFLARE_PROVIDER,
          operation,
          message: 'Cloudflare API request could not be encoded.',
          cause,
        }),
    ),
    Effect.flatMap((encoded) =>
      client.execute(encoded).pipe(
        Effect.mapError(
          (cause) =>
            new MailDomainProviderRequestError({
              provider: CLOUDFLARE_PROVIDER,
              operation,
              message: 'Cloudflare API request could not be completed.',
              cause,
            }),
        ),
      ),
    ),
  )

/** Decodes one untrusted JSON response with its endpoint-specific schema. */
const decodeResponse = <S extends Schema.Constraint>(
  schema: S,
  operation: Operation,
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<
  S['Type'],
  MailDomainProviderResponseError,
  S['DecodingServices']
> =>
  HttpClientResponse.schemaBodyJson(schema)(response).pipe(
    Effect.mapError(
      (cause) =>
        new MailDomainProviderResponseError({
          provider: CLOUDFLARE_PROVIDER,
          operation,
          statusCode: response.status,
          message: 'Cloudflare returned an invalid mail-domain response.',
          cause,
        }),
    ),
  )

/** Makes documented optional envelope results explicit failures to callers. */
const requireResult = <A>(
  operation: Operation,
  statusCode: number,
  result: A | undefined,
): Effect.Effect<A, MailDomainProviderResponseError> =>
  result === undefined
    ? Effect.fail(
        new MailDomainProviderResponseError({
          provider: CLOUDFLARE_PROVIDER,
          operation,
          statusCode,
          message: 'Cloudflare accepted the operation without a result.',
        }),
      )
    : Effect.succeed(result)

/** Normalizes a documented Email Sending result into Garden's domain model. */
const sendingSubdomain = (
  zoneId: MailDomainZoneId,
  result: CloudflareSendingSubdomain,
): ProvisionedSendingSubdomain => ({
  provider: CLOUDFLARE_PROVIDER,
  zoneId,
  providerDomainId: result.tag,
  name: result.name,
  enabled: result.enabled,
  createdAt: result.created ?? null,
  modifiedAt: result.modified ?? null,
  dkimSelector:
    result.dkim_selector === undefined || result.dkim_selector.trim() === ''
      ? null
      : result.dkim_selector,
  previewEnabled: result.preview_enabled ?? null,
  returnPathDomain: result.return_path_domain ?? null,
})

/** Preserves all documented Cloudflare routing states without leaking syntax. */
const emailRoutingState = (
  zoneId: MailDomainZoneId,
  result: CloudflareEmailRoutingSettings,
): EmailRoutingState => ({
  provider: CLOUDFLARE_PROVIDER,
  zoneId,
  providerRoutingId: result.id,
  domain: result.name,
  enabled: result.enabled,
  status:
    result.status === 'misconfigured/locked'
      ? 'misconfigured_locked'
      : (result.status ?? null),
  createdAt: result.created ?? null,
  modifiedAt: result.modified ?? null,
  wizardSkipped: result.skip_wizard ?? null,
  supportsSubaddressing: result.support_subaddress ?? null,
})

/** Checks that a successful update actually describes enabled Worker delivery. */
const confirmCatchAllWorker = (
  input: SetCatchAllWorkerDeliveryInput,
  workerName: MailWorkerName,
  statusCode: number,
  result: CloudflareCatchAllRule,
): Effect.Effect<CatchAllWorkerDelivery, MailDomainProviderResponseError> => {
  const hasWorker = result.actions?.some(
    (action) => action.type === 'worker' && action.value?.includes(workerName),
  )
  const matchesAll = result.matchers?.some((matcher) => matcher.type === 'all')

  if (result.enabled !== true || hasWorker !== true || matchesAll !== true) {
    return Effect.fail(
      new MailDomainProviderResponseError({
        provider: CLOUDFLARE_PROVIDER,
        operation: 'setCatchAllWorkerDelivery',
        statusCode,
        message:
          'Cloudflare did not confirm enabled catch-all Worker delivery.',
      }),
    )
  }

  return Effect.succeed({
    provider: CLOUDFLARE_PROVIDER,
    zoneId: input.zoneId,
    providerRuleId: result.id ?? null,
    workerName,
    enabled: true,
  })
}

/** Encodes path identifiers so provider-owned values cannot alter API routes. */
const zonePath = (zoneId: MailDomainZoneId): string =>
  `/zones/${encodeURIComponent(zoneId)}`

/**
 * Cloudflare infrastructure adapter. Endpoints and wire contracts follow the
 * official Email Sending and Email Routing REST API linked on the schemas above.
 */
export const cloudflareDomainProviderLayer = Layer.effect(
  MailDomainProvider,
  Effect.gen(function* () {
    const baseClient = yield* HttpClient.HttpClient
    const config = yield* CloudflareDomainProviderConfig
    const client = baseClient.pipe(
      HttpClient.mapRequest((request) =>
        request.pipe(
          HttpClientRequest.prependUrl(config.apiBaseUrl),
          HttpClientRequest.bearerToken(config.apiToken),
          HttpClientRequest.acceptJson,
        ),
      ),
    )

    return MailDomainProvider.of({
      resolveDomainZone: Effect.fn(
        'CloudflareDomainProvider.resolveDomainZone',
      )(function* (input: ResolveMailDomainZoneInput) {
        const request = HttpClientRequest.get('/zones').pipe(
          HttpClientRequest.appendUrlParams({
            'account.id': config.accountId,
            name: input.name,
            status: 'active',
            match: 'all',
            per_page: '5',
          }),
        )
        const response = yield* executeRequest(
          client,
          'resolveDomainZone',
          Effect.succeed(request),
        )
        const decoded = yield* decodeResponse(
          CloudflareZoneListEnvelope,
          'resolveDomainZone',
          response,
        )
        const accepted = yield* ensureAccepted(
          'resolveDomainZone',
          response.status,
          decoded,
        )
        const zones = yield* requireResult(
          'resolveDomainZone',
          response.status,
          accepted.result,
        )
        const matches = zones.filter((zone) => zone.name === input.name)
        if (matches.length === 0) {
          return yield* new MailDomainProviderNotFoundError({
            provider: CLOUDFLARE_PROVIDER,
            operation: 'resolveDomainZone',
            resource: 'domain_zone',
            resourceId: input.name,
            message:
              'No active Cloudflare zone in the configured account matches this domain.',
          })
        }
        if (matches.length !== 1) {
          return yield* new MailDomainProviderResponseError({
            provider: CLOUDFLARE_PROVIDER,
            operation: 'resolveDomainZone',
            statusCode: response.status,
            message:
              'Cloudflare returned more than one active zone for this domain.',
          })
        }
        const zone = matches[0]!
        return {
          provider: CLOUDFLARE_PROVIDER,
          zoneId: zone.id,
          name: zone.name,
        } satisfies ResolvedMailDomainZone
      }),
      registerSendingSubdomain: Effect.fn(
        'CloudflareDomainProvider.registerSendingSubdomain',
      )(function* (input: SendingSubdomainRegistration) {
        const request = HttpClientRequest.schemaBodyJson(
          CreateSendingSubdomainBody,
        )(
          HttpClientRequest.post(
            `${zonePath(input.zoneId)}/email/sending/subdomains`,
          ),
          { name: input.name },
        )
        const response = yield* executeRequest(
          client,
          'registerSendingSubdomain',
          request,
        )
        const decoded = yield* decodeResponse(
          CloudflareSendingSubdomainEnvelope,
          'registerSendingSubdomain',
          response,
        )
        const accepted = yield* ensureAccepted(
          'registerSendingSubdomain',
          response.status,
          decoded,
        )
        const result = yield* requireResult(
          'registerSendingSubdomain',
          response.status,
          accepted.result,
        )
        return sendingSubdomain(input.zoneId, result)
      }),
      inspectSendingSubdomain: Effect.fn(
        'CloudflareDomainProvider.inspectSendingSubdomain',
      )(function* (input: SendingSubdomainReference) {
        const response = yield* executeRequest(
          client,
          'inspectSendingSubdomain',
          Effect.succeed(
            HttpClientRequest.get(
              `${zonePath(input.zoneId)}/email/sending/subdomains/${encodeURIComponent(input.providerDomainId)}`,
            ),
          ),
        )
        if (response.status === 404) {
          return yield* new MailDomainProviderNotFoundError({
            provider: CLOUDFLARE_PROVIDER,
            operation: 'inspectSendingSubdomain',
            resource: 'sending_subdomain',
            resourceId: input.providerDomainId,
            message: 'Cloudflare sending subdomain was not found.',
          })
        }

        const decoded = yield* decodeResponse(
          CloudflareSendingSubdomainEnvelope,
          'inspectSendingSubdomain',
          response,
        )
        const accepted = yield* ensureAccepted(
          'inspectSendingSubdomain',
          response.status,
          decoded,
        )
        const result = yield* requireResult(
          'inspectSendingSubdomain',
          response.status,
          accepted.result,
        )
        return sendingSubdomain(input.zoneId, result)
      }),
      deleteSendingSubdomain: Effect.fn(
        'CloudflareDomainProvider.deleteSendingSubdomain',
      )(function* (input: SendingSubdomainReference) {
        const response = yield* executeRequest(
          client,
          'deleteSendingSubdomain',
          Effect.succeed(
            HttpClientRequest.delete(
              `${zonePath(input.zoneId)}/email/sending/subdomains/${encodeURIComponent(input.providerDomainId)}`,
            ),
          ),
        )
        if (response.status === 404) {
          return yield* new MailDomainProviderNotFoundError({
            provider: CLOUDFLARE_PROVIDER,
            operation: 'deleteSendingSubdomain',
            resource: 'sending_subdomain',
            resourceId: input.providerDomainId,
            message: 'Cloudflare sending subdomain was not found.',
          })
        }

        const decoded = yield* decodeResponse(
          CloudflareDeleteEnvelope,
          'deleteSendingSubdomain',
          response,
        )
        yield* ensureAccepted(
          'deleteSendingSubdomain',
          response.status,
          decoded,
        )
      }),
      enableEmailRouting: Effect.fn(
        'CloudflareDomainProvider.enableEmailRouting',
      )(function* (input: EnableEmailRoutingInput) {
        const request = HttpClientRequest.schemaBodyJson(
          EnableEmailRoutingBody,
        )(
          HttpClientRequest.post(`${zonePath(input.zoneId)}/email/routing/dns`),
          { name: input.domain },
        )
        const response = yield* executeRequest(
          client,
          'enableEmailRouting',
          request,
        )
        const decoded = yield* decodeResponse(
          CloudflareEmailRoutingEnvelope,
          'enableEmailRouting',
          response,
        )
        const accepted = yield* ensureAccepted(
          'enableEmailRouting',
          response.status,
          decoded,
        )
        const result = yield* requireResult(
          'enableEmailRouting',
          response.status,
          accepted.result,
        )
        return emailRoutingState(input.zoneId, result)
      }),
      inspectEmailRouting: Effect.fn(
        'CloudflareDomainProvider.inspectEmailRouting',
      )(function* (input: InspectEmailRoutingInput) {
        const response = yield* executeRequest(
          client,
          'inspectEmailRouting',
          Effect.succeed(
            HttpClientRequest.get(`${zonePath(input.zoneId)}/email/routing`),
          ),
        )
        if (response.status === 404) {
          return yield* new MailDomainProviderNotFoundError({
            provider: CLOUDFLARE_PROVIDER,
            operation: 'inspectEmailRouting',
            resource: 'email_routing',
            resourceId: input.zoneId,
            message: 'Cloudflare Email Routing settings were not found.',
          })
        }

        const decoded = yield* decodeResponse(
          CloudflareEmailRoutingEnvelope,
          'inspectEmailRouting',
          response,
        )
        const accepted = yield* ensureAccepted(
          'inspectEmailRouting',
          response.status,
          decoded,
        )
        const result = yield* requireResult(
          'inspectEmailRouting',
          response.status,
          accepted.result,
        )
        return emailRoutingState(input.zoneId, result)
      }),
      setCatchAllWorkerDelivery: Effect.fn(
        'CloudflareDomainProvider.setCatchAllWorkerDelivery',
      )(function* (input: SetCatchAllWorkerDeliveryInput) {
        const request = HttpClientRequest.schemaBodyJson(SetCatchAllWorkerBody)(
          HttpClientRequest.put(
            `${zonePath(input.zoneId)}/email/routing/rules/catch_all`,
          ),
          {
            actions: [{ type: 'worker', value: [config.workerName] }],
            matchers: [{ type: 'all' }],
            enabled: true,
            name: 'Garden Mail catch-all',
            source: 'api',
          },
        )
        const response = yield* executeRequest(
          client,
          'setCatchAllWorkerDelivery',
          request,
        )
        const decoded = yield* decodeResponse(
          CloudflareCatchAllEnvelope,
          'setCatchAllWorkerDelivery',
          response,
        )
        const accepted = yield* ensureAccepted(
          'setCatchAllWorkerDelivery',
          response.status,
          decoded,
        )
        const result = yield* requireResult(
          'setCatchAllWorkerDelivery',
          response.status,
          accepted.result,
        )
        return yield* confirmCatchAllWorker(
          input,
          config.workerName,
          response.status,
          result,
        )
      }),
    })
  }),
)
