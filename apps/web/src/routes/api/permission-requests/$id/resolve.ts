import { Result, TaggedError } from 'better-result'
import { and, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { z } from 'zod'
import { archiveInboxItemsByKey } from '@garden/db/inbox'
import { appEnv } from '@/lib/server/env'
import { schema, type Db } from '@/lib/server/db'
import { json, requireWorkspaceAccess } from '@/lib/server/control-plane'
import { parseJsonBody } from '@/lib/server/validation/common'
import { resolveConnectorWritePermissionRequests } from '@/lib/server/permission-request'
import {
  loadAgentProposalRequest,
  resolveAgentProposalRequest,
} from '@/lib/server/agent-proposal-request'
import {
  requireWorkspacePermission,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'

class PermissionResolveError extends TaggedError('PermissionResolveError')<{
  status: number
  message: string
  cause?: unknown
}>() {}

const resolvePermissionBodySchema = z.object({
  approved: z.boolean(),
})

type ConnectorPermissionRequestRow = {
  id: string
  workspaceId: string
}

/** Loads only connector approvals from the legacy mixed ledger. */
async function loadConnectorPermissionRequest(db: Db, id: string) {
  return Result.tryPromise({
    try: async () => {
      const rows = await db
        .select({
          id: schema.permissionRequest.id,
          workspaceId: schema.agent.workspaceId,
        })
        .from(schema.permissionRequest)
        .innerJoin(
          schema.agent,
          eq(schema.agent.id, schema.permissionRequest.agentId),
        )
        .where(
          and(
            eq(schema.permissionRequest.id, id),
            eq(schema.permissionRequest.kind, 'connector_write'),
          ),
        )
        .limit(1)
      const row = rows[0]
      return row ? (row satisfies ConnectorPermissionRequestRow) : null
    },
    catch: (cause) =>
      new PermissionResolveError({
        status: 500,
        message: 'Failed to load connector permission request',
        cause,
      }),
  })
}

export const Route = createFileRoute('/api/permission-requests/$id/resolve')({
  server: {
    handlers: {
      POST: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const bodyResult = await parseJsonBody(
          request,
          resolvePermissionBodySchema,
          'Invalid permission resolve payload',
        )
        if (bodyResult.isErr()) {
          return json({ error: bodyResult.error.message }, 400)
        }

        const db = await appContext.db()
        const proposalRequestResult = await loadAgentProposalRequest({
          db,
          requestId: params.id,
        })
        if (proposalRequestResult.isErr()) {
          return json(
            { error: proposalRequestResult.error.message },
            proposalRequestResult.error.status,
          )
        }

        const proposalRequest = proposalRequestResult.value
        if (proposalRequest) {
          const access = await requireWorkspaceAccess(
            appContext,
            proposalRequest.workspaceId,
          )
          if (access instanceof Response) return access
          const permission = await requireWorkspacePermission({
            appContext,
            request,
            workspaceId: proposalRequest.workspaceId,
            permissions: workspacePermissions.permissionManage,
          })
          if (permission) return permission

          const proposalResult = await resolveAgentProposalRequest({
            actorUserId: access.session.user.id,
            approved: bodyResult.value.approved,
            db,
            env: appEnv,
            requestId: proposalRequest.id,
            runActor: { type: 'member', id: access.session.user.id },
            workspaceId: proposalRequest.workspaceId,
          })
          if (proposalResult.isErr()) {
            return json(
              { error: proposalResult.error.message },
              proposalResult.error.status,
            )
          }

          await archiveInboxItemsByKey({
            db,
            workspaceId: proposalRequest.workspaceId,
            itemKeys: [`approval:${proposalRequest.id}`],
          })
          return Response.json({
            ok: true,
            invalidations: [
              'inbox',
              'agents',
              ...(proposalResult.value.sourceIssueId ? ['issues'] : []),
            ],
          })
        }

        const connectorRequestResult = await loadConnectorPermissionRequest(
          db,
          params.id,
        )
        if (connectorRequestResult.isErr()) {
          return json(
            { error: connectorRequestResult.error.message },
            connectorRequestResult.error.status,
          )
        }
        if (!connectorRequestResult.value) {
          return json({ error: 'Permission request not found' }, 404)
        }

        const connectorRequest = connectorRequestResult.value
        const access = await requireWorkspaceAccess(
          appContext,
          connectorRequest.workspaceId,
        )
        if (access instanceof Response) return access
        const permission = await requireWorkspacePermission({
          appContext,
          request,
          workspaceId: connectorRequest.workspaceId,
          permissions: workspacePermissions.permissionManage,
        })
        if (permission) return permission

        const resolutionResult = await resolveConnectorWritePermissionRequests({
          approved: bodyResult.value.approved,
          actorUserId: access.session.user.id,
          db,
          permissionRequestId: connectorRequest.id,
          workspaceId: connectorRequest.workspaceId,
        })
        if (resolutionResult.isErr()) {
          return json(
            { error: resolutionResult.error.message },
            resolutionResult.error.status,
          )
        }
        await archiveInboxItemsByKey({
          db,
          workspaceId: connectorRequest.workspaceId,
          itemKeys: [`approval:${connectorRequest.id}`],
        })

        return Response.json({
          ok: true,
          invalidations: ['inbox', 'issues'],
        })
      },
    },
  },
})
