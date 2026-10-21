import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  sourceBindingBodySchema,
  parseJsonBody,
} from '@/lib/server/validation/issues'
import {
  badRequest,
  notFound,
  requireWorkspaceAccess,
} from '@/lib/server/control-plane'
import { serviceErrorResponse } from '@/lib/server/service-error-response'
import {
  requireWorkspacePermission,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'
import {
  attachSourceBinding,
  listIssueSourceBindings,
} from '@garden/core/issues/source-binding'

export const Route = createFileRoute('/api/issues/$id/source-bindings')({
  server: {
    handlers: {
      GET: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const db = await appContext.db()
        const [issue] = await db
          .select({ workspaceId: schema.issue.workspaceId })
          .from(schema.issue)
          .where(eq(schema.issue.id, params.id))
          .limit(1)
        if (!issue) return notFound('Issue not found')

        const access = await requireWorkspaceAccess(
          appContext,
          issue.workspaceId,
        )
        if (access instanceof Response) return access

        const bindingsResult = await listIssueSourceBindings({
          databaseUrl: appEnv.HYPERDRIVE.connectionString,
          issueId: params.id,
        })
        if (bindingsResult.isErr()) {
          return serviceErrorResponse(bindingsResult.error)
        }
        return Response.json(bindingsResult.value)
      },
      POST: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const bodyResult = await parseJsonBody(
          request,
          sourceBindingBodySchema,
          'Invalid source binding payload',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)
        const body = bodyResult.value

        const db = await appContext.db()
        const [issue] = await db
          .select({ workspaceId: schema.issue.workspaceId })
          .from(schema.issue)
          .where(eq(schema.issue.id, params.id))
          .limit(1)
        if (!issue) return notFound('Issue not found')

        const access = await requireWorkspaceAccess(
          appContext,
          issue.workspaceId,
        )
        if (access instanceof Response) return access
        const permission = await requireWorkspacePermission({
          appContext,
          request: appContext.request,
          workspaceId: issue.workspaceId,
          permissions: workspacePermissions.issueManage,
        })
        if (permission) return permission

        const attachResult = await attachSourceBinding({
          databaseUrl: appEnv.HYPERDRIVE.connectionString,
          workspaceId: issue.workspaceId,
          issueId: params.id,
          connectorId: body.connector_id,
          sourceKind: body.source_kind,
          externalId: body.external_id,
          externalUrl: body.external_url,
        })
        if (attachResult.isErr())
          return serviceErrorResponse(attachResult.error)
        return Response.json(attachResult.value, { status: 201 })
      },
    },
  },
})
