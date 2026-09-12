import { Result, TaggedError } from 'better-result'
import { and, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import {
  resolveEffectiveTrust,
  type PermissionTrustLevel,
} from '@garden/connectors/capabilities'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  json,
  notFound,
  requireSession,
  resolveWorkspaceId,
  unauthorized,
} from '@/lib/server/control-plane'
import { schema } from '@/lib/server/db'

class AgentAccessRouteError extends TaggedError('AgentAccessRouteError')<{
  status: number
  message: string
}>() {}

export const Route = createFileRoute('/api/agents/$id/access')({
  server: {
    handlers: {
      GET: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()

        const workspaceId = await resolveWorkspaceId(request, session.user.id)
        if (!workspaceId) {
          return notFound('Workspace not found')
        }

        const db = await appContext.db()

        const agentResult = await Result.tryPromise({
          try: async () =>
            db
              .select({ id: schema.agent.id })
              .from(schema.agent)
              .where(
                and(
                  eq(schema.agent.id, params.id),
                  eq(schema.agent.workspaceId, workspaceId),
                ),
              )
              .limit(1),
          catch: () =>
            new AgentAccessRouteError({
              status: 500,
              message: 'Failed to load agent for access review',
            }),
        })
        if (agentResult.isErr()) {
          return json(
            { error: agentResult.error.message },
            agentResult.error.status,
          )
        }

        if (!agentResult.value[0]) {
          return notFound('Agent not found')
        }

        const accessResult = await Result.tryPromise({
          try: async () => {
            const [capabilities, toolGrants, connectionGrants] =
              await Promise.all([
                db
                  .select({
                    id: schema.capability.id,
                    connectorType: schema.capability.connectorType,
                    name: schema.capability.name,
                    riskClass: schema.capability.riskClass,
                  })
                  .from(schema.capability),
                db
                  .select({
                    capabilityId: schema.permissionGrant.capabilityId,
                    trustLevel: schema.permissionGrant.trustLevel,
                  })
                  .from(schema.permissionGrant)
                  .where(eq(schema.permissionGrant.agentId, params.id)),
                db
                  .select({
                    connectorId: schema.connectionGrant.connectorId,
                    trustLevel: schema.connectionGrant.trustLevel,
                  })
                  .from(schema.connectionGrant)
                  .where(eq(schema.connectionGrant.agentId, params.id)),
              ])
            return { capabilities, toolGrants, connectionGrants }
          },
          catch: () =>
            new AgentAccessRouteError({
              status: 500,
              message: 'Failed to load agent access state',
            }),
        })
        if (accessResult.isErr()) {
          return json(
            { error: accessResult.error.message },
            accessResult.error.status,
          )
        }

        const { capabilities, toolGrants, connectionGrants } =
          accessResult.value
        const toolGrantByCapability = new Map(
          toolGrants.map((grant) => [grant.capabilityId, grant.trustLevel]),
        )
        const connectionGrantByConnector = new Map(
          connectionGrants.map((grant) => [grant.connectorId, grant.trustLevel]),
        )
        const capabilityIdByKey = new Map(
          capabilities.map((capability) => [
            `${capability.connectorType}:${capability.name}`,
            capability.id,
          ]),
        )

        const tools = capabilities.map((capability) => {
          const capabilityId =
            capabilityIdByKey.get(
              `${capability.connectorType}:${capability.name}`,
            ) ?? ''
          const { trust, visible } = resolveEffectiveTrust({
            toolTrust:
              toolGrantByCapability.get(capabilityId) as
                | PermissionTrustLevel
                | undefined,
            connectionTrust:
              connectionGrantByConnector.get(capability.connectorType) as
                | PermissionTrustLevel
                | undefined,
            riskClass: capability.riskClass,
          })
          return {
            connector_id: capability.connectorType,
            tool_name: capability.name,
            risk_class: capability.riskClass,
            trust,
            granted: toolGrantByCapability.has(capabilityId),
            visible,
          }
        })

        return Response.json({
          connections: [...connectionGrantByConnector.entries()].map(
            ([connector_id, trust]) => ({
              connector_id,
              trust,
              granted: true,
              visible: (trust as PermissionTrustLevel) !== 'ask',
            }),
          ),
          tools,
        })
      },
    },
  },
})
