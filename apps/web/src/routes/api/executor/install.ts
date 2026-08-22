import { Effect, Option, Schema } from 'effect'
import { createFileRoute } from '@tanstack/react-router'
import {
  ExecutorInstallAuthorizationRedirect,
  ExecutorInstallRequest,
  ExecutorInstallResponse,
  ExecutorIntegrationSlug,
} from '@/lib/executor-contract'
import { requireAppRequestContext } from '@/lib/server/context'
import { requireWorkspaceContext } from '@/lib/server/control-plane'
import {
  CatalogProviderNotFoundError,
  catalogCandidateSource,
  getExecutorCatalogSurfaces,
  getExecutorProvider,
} from '@/lib/server/executor-engine/catalog'
import {
  ExecutorInstallUnavailableError,
  installProvider,
} from '@/lib/server/executor-engine/install'
import { IntegrationsShDomainSurface } from '@/lib/server/executor-engine/integrations-sh'
import { runExecutorRouteEffect } from '@/lib/server/executor-observability'
import { executorProgram } from '@/lib/server/executor-runtime'

class ExecutorInstallRouteError extends Schema.Error<ExecutorInstallRouteError>(
  'ExecutorInstallRouteError',
)({
  status: Schema.Number,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

/** Decode provider identity, resolve server-owned catalog policy, and execute
 * installation as one Effect program. */
const installResponse = Effect.fn('ExecutorInstall.response')(function* (
  request: Request,
  identity: { readonly tenant: string; readonly subject: string },
) {
  const payload = yield* Effect.mapError(
    Effect.tryPromise(() => request.json()),
    (cause) =>
      new ExecutorInstallRouteError({
        status: 400,
        message: 'Install request must contain valid JSON.',
        cause,
      }),
  )
  const input = yield* Effect.mapError(
    Schema.decodeUnknownEffect(ExecutorInstallRequest)(payload),
    (cause) =>
      new ExecutorInstallRouteError({
        status: 400,
        message: 'Install request must contain a valid provider identity.',
        cause,
      }),
  )
  if (String(input.providerId) === 'discord.com' && input.source === 'native') {
    return ExecutorInstallAuthorizationRedirect.make({
      kind: 'authorization_redirect',
      slug: ExecutorIntegrationSlug.make('discord'),
      connectUrl: '/api/discord/install',
    })
  }
  if (
    String(input.providerId) === 'github.com' &&
    (input.source === 'native' || input.source === 'mcp')
  ) {
    return ExecutorInstallAuthorizationRedirect.make({
      kind: 'authorization_redirect',
      slug: ExecutorIntegrationSlug.make(
        input.source === 'mcp' ? 'github--mcp' : 'github',
      ),
      connectUrl: '/api/github/install',
    })
  }

  const provider = yield* Effect.mapError(
    getExecutorProvider(input.providerId),
    (failure) => {
      if (failure instanceof CatalogProviderNotFoundError) {
        return new ExecutorInstallRouteError({
          status: 404,
          message: 'Provider was not found in the integration catalog.',
          cause: failure,
        })
      }
      return new ExecutorInstallRouteError({
        status: 502,
        message: 'Integration catalog is unavailable.',
        cause: failure,
      })
    },
  )
  let surface = IntegrationsShDomainSurface.make({
    domain: String(provider.domain),
    description: Option.none(),
    summary: Option.none(),
    surfaces: [],
  })
  const selectedCandidates = provider.candidates.filter(
    (candidate) => catalogCandidateSource(candidate) === input.source,
  )
  const requiresDiscoverySurface = selectedCandidates.some((candidate) => {
    if (candidate.kind === 'mcp') return Option.isNone(candidate.endpoint)
    if (candidate.kind === 'openapi') return Option.isNone(candidate.spec)
    return false
  })
  if (requiresDiscoverySurface) {
    surface = yield* Effect.mapError(
      getExecutorCatalogSurfaces(selectedCandidates),
      (cause) =>
        new ExecutorInstallRouteError({
          status: 502,
          message: 'Provider surface metadata is unavailable.',
          cause,
        }),
    )
  }
  return yield* Effect.mapError(
    executorProgram(identity, (executor) =>
      installProvider(executor, provider, surface, input.source),
    ),
    (failure) => {
      if (failure instanceof ExecutorInstallUnavailableError) {
        return new ExecutorInstallRouteError({
          status: 422,
          message: failure.reasons.join(' '),
          cause: failure,
        })
      }
      return new ExecutorInstallRouteError({
        status: 500,
        message: 'Executor could not complete the provider installation.',
        cause: failure,
      })
    },
  )
})

export const Route = createFileRoute('/api/executor/install')({
  server: {
    handlers: {
      POST: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const workspaceContext = await requireWorkspaceContext(appContext)
        if (workspaceContext instanceof Response) return workspaceContext

        const outcome = await runExecutorRouteEffect({
          effect: installResponse(request, {
            tenant: workspaceContext.workspaceId,
            subject: workspaceContext.session.user.id,
          }),
          request,
          event: 'executor.install.failed',
          fallbackMessage:
            'Executor could not complete the provider installation.',
        })
        if (!outcome.ok) return outcome.response
        return Response.json(
          Schema.encodeSync(ExecutorInstallResponse)(outcome.value),
        )
      },
    },
  },
})
