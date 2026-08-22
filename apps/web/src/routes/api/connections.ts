import { Effect, Option, Schema } from 'effect'
import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import discordConnector from '@garden/connectors/discord'
import { discordNativeTools } from '@garden/connectors/discord/tools'
import githubConnector from '@garden/connectors/github'
import { githubNativeTools } from '@garden/connectors/github/tools'
import {
  ExecutorConnectionHealth,
  ExecutorConnectionsSnapshot,
  ExecutorConnectionAddress,
  ExecutorHttpsUrl,
  ExecutorIntegrationConnection,
  ExecutorIntegrationItem,
  ExecutorIntegrationSlug,
  ExecutorProviderId,
  ExecutorIntegrationTool,
  ExecutorToolAddress,
  ExecutorAuthMethodNone,
  ExecutorAuthMethodOAuth,
  ExecutorAuthMethodSecret,
  ExecutorAuthPlacement,
  type ExecutorHttpsUrl as ExecutorHttpsUrlType,
  type ExecutorIntegrationSlug as ExecutorIntegrationSlugType,
  type ExecutorIntegrationStatus,
  type ExecutorProviderId as ExecutorProviderIdType,
} from '@/lib/executor-contract'
import { requireAppRequestContext } from '@/lib/server/context'
import { requireWorkspaceContext } from '@/lib/server/control-plane'
import { schema, type Db } from '@/lib/server/db'
import { getDiscordInstallation } from '@/lib/server/discord-install'
import {
  catalogCandidateSource,
  listServerOwnedExecutorProviders,
  providerSourceInstallSlug,
  type CatalogProvider,
} from '@/lib/server/executor-engine/catalog'
import { runExecutorRouteEffect } from '@/lib/server/executor-observability'
import {
  loadExecutorCatalog,
  type ExecutorCatalog,
} from '@/lib/server/executor-runtime'

const parseDisplayUrl = (value: string): Option.Option<URL> =>
  Option.fromNullishOr(URL.parse(value))

/** Maps direct Executor SDK auth descriptors into Garden's product contract. */
const modelExecutorAuthMethods = (
  integration: ExecutorCatalog['integrations'][number],
) =>
  integration.authMethods.map((method) => {
    if (method.kind === 'none') {
      return ExecutorAuthMethodNone.make({
        kind: 'none',
        id: method.id,
        label: method.label,
        template: method.template,
      })
    }
    if (method.kind === 'oauth') {
      return ExecutorAuthMethodOAuth.make({
        kind: 'oauth',
        id: method.id,
        label: method.label,
        template: method.template,
        authorizationUrl: Schema.decodeUnknownOption(ExecutorHttpsUrl)(
          method.oauth?.authorizationUrl,
        ),
        tokenUrl: Schema.decodeUnknownOption(ExecutorHttpsUrl)(
          method.oauth?.tokenUrl,
        ),
        resource: Schema.decodeUnknownOption(ExecutorHttpsUrl)(
          method.oauth?.resource,
        ),
        scopes: [...(method.oauth?.scopes ?? [])],
      })
    }
    return ExecutorAuthMethodSecret.make({
      kind: 'secret',
      id: method.id,
      label: method.label,
      template: method.template,
      placements: (method.placements ?? []).flatMap((placement) =>
        placement.literal === undefined
          ? [
              ExecutorAuthPlacement.make({
                carrier: placement.carrier,
                name: placement.name,
                prefix: placement.prefix ?? '',
                variable: placement.variable ?? 'token',
              }),
            ]
          : [],
      ),
    })
  })

class ExecutorConnectionsRouteError extends Schema.Error<ExecutorConnectionsRouteError>(
  'ExecutorConnectionsRouteError',
)({
  status: Schema.Number,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

const githubNativeToolsByName = new Map(
  githubNativeTools.map((tool) => [tool.name, tool]),
)

/** Projects the classified hosted-MCP surface without opening a GitHub network
 * session during a connections read. Capability sync uses the same static
 * connector contract; provider availability is checked only when a tool runs. */
const githubHostedMcpTools = Object.entries(githubConnector.tools).map(
  ([name, classification]) => {
    const nativeTool = githubNativeToolsByName.get(name)
    return ExecutorIntegrationTool.make({
      address: ExecutorToolAddress.make(`mcp:github:${name}`),
      name,
      description:
        classification.descriptionOverride ??
        nativeTool?.description ??
        `${githubConnector.label} hosted MCP tool.`,
    })
  },
)

const integrationStatus = (
  canRemove: boolean,
  healthStatuses: readonly string[],
  connectionCount: number,
): ExecutorIntegrationStatus => {
  if (connectionCount === 0) {
    if (canRemove) return 'setup_required'
    return 'available'
  }
  const unhealthy = healthStatuses.some(
    (health) => health === 'degraded' || health === 'expired',
  )
  if (unhealthy) return 'degraded'
  return 'connected'
}

const providerForIntegration = (
  providers: readonly CatalogProvider[],
  slug: ExecutorIntegrationSlugType,
): Option.Option<CatalogProvider> =>
  Option.fromNullishOr(
    providers.find((candidate) => {
      if (candidate.installSlug === slug) return true
      if (candidate.candidates.some((surface) => surface.slug === slug)) {
        return true
      }
      const sources = new Set(candidate.candidates.map(catalogCandidateSource))
      return [...sources].some(
        (source) => providerSourceInstallSlug(candidate, source) === slug,
      )
    }),
  )

const providerIdForIntegration = (
  provider: Option.Option<CatalogProvider>,
  slug: ExecutorIntegrationSlugType,
  displayUrl: Option.Option<ExecutorHttpsUrlType>,
): ExecutorProviderIdType => {
  if (Option.isSome(provider)) return provider.value.providerId

  if (Option.isSome(displayUrl)) {
    const parsed = parseDisplayUrl(String(displayUrl.value))
    if (Option.isSome(parsed)) {
      const hostname = parsed.value.hostname.toLowerCase()
      const decoded = Schema.decodeUnknownOption(ExecutorProviderId)(hostname)
      if (Option.isSome(decoded)) return decoded.value
    }
  }
  return ExecutorProviderId.make(String(slug))
}

/** Join SDK-owned installed state with server-owned provider identity and build
 * the shared connections Schema. */
const connectionsResponse = Effect.fn('ExecutorConnections.response')(
  function* (
    identity: { readonly tenant: string; readonly subject: string },
    db: Db,
  ) {
    const providers = listServerOwnedExecutorProviders()
    const [
      [integrationStates, connections, tools],
      githubInstallation,
      discordInstallation,
    ] = yield* Effect.all(
      [
        loadExecutorCatalog(identity).pipe(
          Effect.map(
            (catalog) =>
              [
                catalog.integrations.map((integration) => ({
                  integration,
                  authMethods: modelExecutorAuthMethods(integration),
                })),
                catalog.connections,
                catalog.tools,
              ] as const,
          ),
        ),
        Effect.tryPromise(() =>
          db
            .select()
            .from(schema.githubAppInstallation)
            .where(
              eq(schema.githubAppInstallation.workspaceId, identity.tenant),
            )
            .limit(1),
        ),
        getDiscordInstallation(db, identity.tenant),
      ] as const,
      { concurrency: 'unbounded' },
    )

    const items = integrationStates.map(({ integration, authMethods }) => {
      const slug = ExecutorIntegrationSlug.make(String(integration.slug))
      const displayUrl = Schema.decodeUnknownOption(ExecutorHttpsUrl)(
        integration.displayUrl,
      )
      const provider = providerForIntegration(providers, slug)
      const integrationConnections = connections.filter(
        (connection) => connection.integration === integration.slug,
      )
      const integrationTools = tools.filter(
        (tool) => tool.integration === integration.slug,
      )
      const healthStatuses = integrationConnections.map((connection) => {
        const health = Option.fromNullishOr(connection.lastHealth)
        if (Option.isNone(health)) return 'unknown'
        return health.value.status
      })
      const status = integrationStatus(
        integration.canRemove,
        healthStatuses,
        integrationConnections.length,
      )

      return ExecutorIntegrationItem.make({
        providerId: providerIdForIntegration(provider, slug, displayUrl),
        slug,
        label: integration.name,
        description: integration.description,
        protocol:
          integration.family === 'google' ? 'google-api' : integration.kind,
        icon: Option.flatMap(
          provider,
          (catalogProvider) => catalogProvider.icon,
        ),
        displayUrl,
        status,
        canRemove: integration.canRemove,
        canRefresh: integration.canRefresh,
        authMethods,
        connections: integrationConnections.map((connection) => {
          const health = Option.map(
            Option.fromNullishOr(connection.lastHealth),
            (lastHealth) =>
              ExecutorConnectionHealth.make({
                status: lastHealth.status,
                detail: Option.fromNullishOr(lastHealth.detail),
                checkedAt: lastHealth.checkedAt,
              }),
          )
          return ExecutorIntegrationConnection.make({
            owner: connection.owner,
            name: String(connection.name),
            address: ExecutorConnectionAddress.make(String(connection.address)),
            identityLabel: Option.fromNullishOr(connection.identityLabel),
            expiresAt: Option.fromNullishOr(connection.expiresAt),
            health,
          })
        }),
        tools: integrationTools.map((tool) =>
          ExecutorIntegrationTool.make({
            address: ExecutorToolAddress.make(String(tool.address)),
            name: tool.name,
            description: tool.description,
          }),
        ),
      })
    })

    const github = githubInstallation[0]
    if (github !== undefined && github.status !== 'disconnected') {
      const githubStatus =
        github.status === 'degraded' ? 'degraded' : 'connected'
      const githubConnection = ExecutorIntegrationConnection.make({
        owner: 'org',
        name: github.accountLogin,
        address: ExecutorConnectionAddress.make(
          `github:installation:${github.installationId}`,
        ),
        identityLabel: Option.some(github.accountLogin),
        expiresAt: Option.none(),
        health: Option.none(),
      })
      const githubTools = githubNativeTools.map((tool) =>
        ExecutorIntegrationTool.make({
          address: ExecutorToolAddress.make(`native:github:${tool.name}`),
          name: tool.name,
          description: tool.description,
        }),
      )
      const githubIcon = Option.some(
        ExecutorHttpsUrl.make('https://svgl.app/library/github_dark.svg'),
      )
      const githubDisplayUrl = Option.some(
        ExecutorHttpsUrl.make('https://github.com'),
      )
      items.push(
        ExecutorIntegrationItem.make({
          providerId: ExecutorProviderId.make('github.com'),
          slug: ExecutorIntegrationSlug.make('github'),
          label: 'GitHub',
          description:
            'Repository-scoped access through the Garden GitHub App installation.',
          protocol: 'github-app',
          icon: githubIcon,
          displayUrl: githubDisplayUrl,
          status: githubStatus,
          canRemove: true,
          canRefresh: true,
          authMethods: [],
          connections: [githubConnection],
          tools: githubTools,
        }),
        ExecutorIntegrationItem.make({
          providerId: ExecutorProviderId.make('github.com'),
          slug: ExecutorIntegrationSlug.make('github--mcp'),
          label: 'GitHub',
          description:
            'Official GitHub MCP tool surface authenticated by the Garden GitHub App.',
          protocol: 'mcp',
          icon: githubIcon,
          displayUrl: githubDisplayUrl,
          status: githubStatus,
          canRemove: false,
          canRefresh: false,
          authMethods: [],
          connections: [githubConnection],
          tools: githubHostedMcpTools,
        }),
      )
    }

    if (
      discordInstallation !== null &&
      discordInstallation.status !== 'disconnected'
    ) {
      const discordStatus =
        discordInstallation.status === 'degraded' ? 'degraded' : 'connected'
      items.push(
        ExecutorIntegrationItem.make({
          providerId: ExecutorProviderId.make('discord.com'),
          slug: ExecutorIntegrationSlug.make('discord'),
          label: discordConnector.label,
          description: discordConnector.description,
          protocol: 'discord-bot',
          icon: Option.some(
            ExecutorHttpsUrl.make('https://integrations.sh/logo/discord.com'),
          ),
          displayUrl: Option.some(ExecutorHttpsUrl.make('https://discord.com')),
          status: discordStatus,
          canRemove: true,
          canRefresh: true,
          authMethods: [],
          connections: [
            ExecutorIntegrationConnection.make({
              owner: 'org',
              name: discordInstallation.guildName,
              address: ExecutorConnectionAddress.make(
                `discord:guild:${discordInstallation.guildId}`,
              ),
              identityLabel: Option.some(discordInstallation.guildName),
              expiresAt: Option.none(),
              health: Option.none(),
            }),
          ],
          tools: discordNativeTools.map((tool) =>
            ExecutorIntegrationTool.make({
              address: ExecutorToolAddress.make(`native:discord:${tool.name}`),
              name: tool.name,
              description: tool.description,
            }),
          ),
        }),
      )
    }

    return ExecutorConnectionsSnapshot.make({ integrations: items })
  },
)

export const Route = createFileRoute('/api/connections')({
  server: {
    handlers: {
      GET: async ({ context }) => {
        const appContext = requireAppRequestContext(context)
        const workspaceContext = await requireWorkspaceContext(appContext)
        if (workspaceContext instanceof Response) return workspaceContext

        const db = await appContext.db()
        const outcome = await runExecutorRouteEffect({
          effect: Effect.mapError(
            connectionsResponse(
              {
                tenant: workspaceContext.workspaceId,
                subject: workspaceContext.session.user.id,
              },
              db,
            ),
            (cause) =>
              new ExecutorConnectionsRouteError({
                status: 502,
                message: 'Connections could not be loaded.',
                cause,
              }),
          ),
          request: appContext.request,
          event: 'executor.connections.failed',
          fallbackMessage: 'Connections could not be loaded.',
        })
        if (!outcome.ok) return outcome.response
        return Response.json(
          Schema.encodeSync(ExecutorConnectionsSnapshot)(outcome.value),
        )
      },
    },
  },
})
