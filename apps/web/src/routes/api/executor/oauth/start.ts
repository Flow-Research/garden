import { Effect, Option, Schema } from 'effect'
import { createFileRoute } from '@tanstack/react-router'
import {
  AuthTemplateSlug,
  ConnectionName,
  IntegrationSlug,
  OAuthClientSlug,
  type OAuthProbeResult,
} from '@executor-js/sdk/core'
import {
  ExecutorConnectionOwner,
  ExecutorIntegrationSlug,
} from '@/lib/executor-contract'
import { requireAppRequestContext } from '@/lib/server/context'
import { requireWorkspaceContext } from '@/lib/server/control-plane'
import { appEnv } from '@/lib/server/env'
import {
  ensureServerManagedOAuthClient,
  oauthClientSupportsMethod,
} from '@/lib/server/executor-engine/auth-contract'
import {
  ConnectionOwnership,
  connectionOwnershipLayer,
} from '@/lib/server/executor-engine/connection-ownership'
import { runExecutorRouteEffect } from '@/lib/server/executor-observability'
import { executorProgram } from '@/lib/server/executor-runtime'
import {
  requireWorkspacePermission,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'

class ExecutorOAuthRouteError extends Schema.ErrorClass<ExecutorOAuthRouteError>(
  'ExecutorOAuthRouteError',
)({
  status: Schema.Number,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

const routeFailure = (message: string, cause: unknown, status = 502) =>
  new ExecutorOAuthRouteError({ status, message, cause })

/** Starts one owner-scoped OAuth flow. Existing user/workspace clients remain
 * valid, Google is provisioned from deployment-owned credentials, and RFC 7591
 * remains available for providers that explicitly publish dynamic registration.
 * Manual client registration was removed because provider apps are host policy. */
export const beginOAuth = Effect.fn('ExecutorOAuth.begin')(function* (
  request: Request,
  identity: { readonly tenant: string; readonly subject: string },
) {
  const ownership = yield* ConnectionOwnership
  const requestUrl = URL.parse(request.url)
  const rawIntegration = requestUrl?.searchParams.get('integration') ?? null
  const integrationSlug = yield* Effect.mapError(
    Schema.decodeUnknownEffect(ExecutorIntegrationSlug)(rawIntegration),
    (cause) =>
      new ExecutorOAuthRouteError({
        status: 400,
        message: 'Integration is required.',
        cause,
      }),
  )
  const redirectUri = new URL('/api/oauth/callback', request.url).toString()

  return yield* Effect.mapError(
    executorProgram(identity, (executor) =>
      Effect.fn('ExecutorOAuth.startExecutorFlow')(function* () {
        const integrationId = IntegrationSlug.make(String(integrationSlug))
        const integration = yield* executor.integrations.get(integrationId)
        if (integration === null) {
          return yield* new ExecutorOAuthRouteError({
            status: 404,
            message: 'Integration was not found.',
          })
        }

        const method = integration.authMethods.find(
          (candidate) => candidate.kind === 'oauth',
        )
        const oauth = method?.oauth
        if (method === undefined || oauth === undefined) {
          return yield* new ExecutorOAuthRouteError({
            status: 409,
            message: 'Integration does not publish an OAuth method.',
          })
        }

        const clients = yield* executor.oauth.listClients()
        const existingClient = yield* ownership.selectOAuthClient(
          clients,
          (candidate) =>
            oauthClientSupportsMethod(candidate, integration, method),
        )
        let client = Option.map(existingClient, (candidate) => candidate.slug)
        let clientOwner = Option.match(existingClient, {
          onNone: () => ownership.owner,
          onSome: (candidate) => candidate.owner,
        })

        if (Option.isNone(client)) {
          const managedClient = yield* ensureServerManagedOAuthClient(
            executor.oauth,
            integration,
            method,
            appEnv,
          )
          if (Option.isSome(managedClient)) {
            client = Option.some(managedClient.value.slug)
            clientOwner = managedClient.value.owner
          }
        }

        if (Option.isNone(client)) {
          let discovered = Option.none<OAuthProbeResult>()
          if (oauth.discoveryUrl !== undefined) {
            discovered = Option.some(
              yield* executor.oauth.probe({ url: oauth.discoveryUrl }),
            )
          }

          const authorizationUrl = Option.orElse(
            Option.fromNullishOr(oauth.authorizationUrl),
            () => Option.map(discovered, (value) => value.authorizationUrl),
          )
          const tokenUrl = Option.orElse(
            Option.fromNullishOr(oauth.tokenUrl),
            () => Option.map(discovered, (value) => value.tokenUrl),
          )
          const registrationEndpoint = Option.orElse(
            Option.fromNullishOr(oauth.registrationEndpoint),
            () =>
              Option.flatMap(discovered, (value) =>
                Option.fromNullishOr(value.registrationEndpoint),
              ),
          )

          if (
            Option.isSome(authorizationUrl) &&
            Option.isSome(tokenUrl) &&
            Option.isSome(registrationEndpoint) &&
            oauth.supportsDynamicRegistration === true
          ) {
            const dynamicClient = yield* executor.oauth.registerDynamicClient({
              owner: ownership.owner,
              slug: OAuthClientSlug.make(`${integrationSlug}-garden`),
              issuer: Option.getOrNull(
                Option.flatMap(discovered, (value) =>
                  Option.fromNullishOr(value.issuer),
                ),
              ),
              registrationEndpoint: registrationEndpoint.value,
              authorizationUrl: authorizationUrl.value,
              tokenUrl: tokenUrl.value,
              resource: Option.getOrNull(
                Option.orElse(Option.fromNullishOr(oauth.resource), () =>
                  Option.flatMap(discovered, (value) =>
                    Option.fromNullishOr(value.resource),
                  ),
                ),
              ),
              scopes: [
                ...(oauth.scopes ??
                  Option.match(discovered, {
                    onNone: () => [],
                    onSome: (value) => value.scopesSupported ?? [],
                  })),
              ],
              tokenEndpointAuthMethodsSupported: Option.match(discovered, {
                onNone: () => undefined,
                onSome: (value) => value.tokenEndpointAuthMethodsSupported,
              }),
              clientName: 'Garden',
              redirectUri,
              originIntegration: integrationId,
            })
            client = Option.some(dynamicClient)
            clientOwner = ownership.owner
          }
        }

        if (Option.isNone(client)) {
          return yield* new ExecutorOAuthRouteError({
            status: 503,
            message: 'OAuth is not configured for this integration.',
          })
        }

        return yield* executor.oauth.start({
          client: client.value,
          clientOwner,
          owner: ownership.owner,
          name: ConnectionName.make(integration.name),
          integration: integrationId,
          template: AuthTemplateSlug.make(method.template),
          redirectUri,
        })
      })(),
    ),
    (failure) => {
      if (failure instanceof ExecutorOAuthRouteError) return failure
      return routeFailure('OAuth authorization could not be started.', failure)
    },
  )
})

export const Route = createFileRoute('/api/executor/oauth/start')({
  server: {
    handlers: {
      GET: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const workspaceContext = await requireWorkspaceContext(appContext)
        if (workspaceContext instanceof Response) return workspaceContext

        const requestUrl = URL.parse(request.url)
        const owner = Schema.decodeUnknownOption(ExecutorConnectionOwner)(
          requestUrl?.searchParams.get('owner') ?? null,
        )
        if (Option.isNone(owner)) {
          return Response.json(
            { error: 'Connection owner must be Personal or Workspace.' },
            { status: 400 },
          )
        }
        if (owner.value === 'org') {
          const permission = await requireWorkspacePermission({
            appContext,
            request,
            workspaceId: workspaceContext.workspaceId,
            permissions: workspacePermissions.connectionManage,
          })
          if (permission) return permission
        }

        const outcome = await runExecutorRouteEffect({
          effect: beginOAuth(request, {
            tenant: workspaceContext.workspaceId,
            subject: workspaceContext.session.user.id,
          }).pipe(Effect.provide(connectionOwnershipLayer(owner.value))),
          request,
          event: 'executor.oauth.start.failed',
          fallbackMessage: 'OAuth authorization could not be started.',
        })
        if (!outcome.ok) return outcome.response
        if (outcome.value.status === 'redirect') {
          return Response.redirect(outcome.value.authorizationUrl)
        }
        return Response.redirect('/workspace')
      },
    },
  },
})
