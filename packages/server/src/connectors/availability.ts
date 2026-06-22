import { and, eq } from 'drizzle-orm'
import type { NeonDatabase } from 'drizzle-orm/neon-serverless'
import { connectorRegistry, getConnectorById } from '@garden/connectors'
import {
  isMcpConnector,
  isNativeConnector,
  type ConnectorSpec,
} from '@garden/connectors/sdk'
import * as schema from '@garden/db/schema'

export type ConnectorAuthKind = 'oauth' | 'github_app' | 'api_key' | 'none'

export type AvailableConnectorBinding = {
  connectorId: string
  status: 'connected'
  authKind: ConnectorAuthKind
  accountId: string | null
  accountLogin: string | null
  repositorySelection?: string | null
}

type ConnectorAvailabilityDb = NeonDatabase<typeof schema>

export async function listAvailableConnectorBindings(args: {
  db: ConnectorAvailabilityDb
  getEnvVar?: (name: string) => string | undefined
  userId: string
  workspaceId: string
}): Promise<AvailableConnectorBinding[]> {
  const db = args.db
  const [accounts, githubInstallations] = await Promise.all([
    db
      .select({
        accountId: schema.account.id,
        accountLogin: schema.account.accountId,
        connectorId: schema.account.connectorType,
      })
      .from(schema.account)
      .where(
        and(
          eq(schema.account.workspaceId, args.workspaceId),
          eq(schema.account.userId, args.userId),
          eq(schema.account.status, 'connected'),
        ),
      ),
    db
      .select({
        accountLogin: schema.githubAppInstallation.accountLogin,
        id: schema.githubAppInstallation.id,
        repositorySelection: schema.githubAppInstallation.repositorySelection,
      })
      .from(schema.githubAppInstallation)
      .where(
        and(
          eq(schema.githubAppInstallation.workspaceId, args.workspaceId),
          eq(schema.githubAppInstallation.status, 'connected'),
        ),
      )
      .limit(1),
  ])

  const oauthBindings = accounts.flatMap((row) => {
    const connectorId = row.connectorId?.trim()
    const connector = connectorId ? getConnectorById(connectorId) : undefined
    if (!connectorId || !connector || !isMcpConnector(connector) || !connector.oauth) {
      return []
    }

    return [
      {
        connectorId,
        status: 'connected' as const,
        authKind: 'oauth' as const,
        accountId: row.accountId,
        accountLogin: row.accountLogin,
      },
    ]
  })

  const githubBindings =
    githubInstallations.length > 0
      ? [
          {
            connectorId: 'github',
            status: 'connected' as const,
            authKind: 'github_app' as const,
            accountId: null,
            accountLogin: githubInstallations[0]?.accountLogin ?? null,
            repositorySelection:
              githubInstallations[0]?.repositorySelection ?? null,
          },
        ]
      : []

  const nonOAuthBindings = (connectorRegistry as readonly ConnectorSpec[]).flatMap<AvailableConnectorBinding>((connector) => {
    if (isNativeConnector(connector)) {
      return connector.native.availability === 'always'
        ? [
            {
              connectorId: connector.id,
              status: 'connected' as const,
              authKind: 'none' as const,
              accountId: null,
              accountLogin: null,
            },
          ]
        : []
    }

    if (!connector.oauth && !connector.apiKey) {
      return [
        {
          connectorId: connector.id,
          status: 'connected' as const,
          authKind: 'none' as const,
          accountId: null,
          accountLogin: null,
        },
      ]
    }

    const apiKey = connector.apiKey
      ? args.getEnvVar?.(connector.apiKey.envVar)?.trim()
      : undefined

    return connector.apiKey && apiKey
      ? [
          {
            connectorId: connector.id,
            status: 'connected' as const,
            authKind: 'api_key' as const,
            accountId: null,
            accountLogin: null,
          },
        ]
      : []
  })

  return [...oauthBindings, ...githubBindings, ...nonOAuthBindings]
}
