
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'

import { appEnv } from '@/lib/server/env'
import {
  sourceBindingBodySchema,
  parseJsonBody,
} from '@/lib/server/validation/issues'
import { badRequest } from '@/lib/server/control-plane'
import { serviceErrorResponse } from '@/lib/server/service-error-response'
import { requireIssueAccess } from '@/lib/server/issue-access'
import {
  requireWorkspacePermission,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'
import {
  attachSourceBinding,
  listIssueSourceBindings,
} from '@garden/server/issues/source-binding'

export const Route = createFileRoute('/api/issues/$id/source-bindings')({
  server: {
    handlers: {
      GET: async ({ context, params }) => {
        const appContext = requireAppRequestContext(context)
        const access = await requireIssueAccess(appContext, params.id)
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

        const access = await requireIssueAccess(appContext, params.id)
        if (access instanceof Response) return access
        const issue = access.issue
        const permission = await requireWorkspacePermission({
          appContext,
          request,
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
