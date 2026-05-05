import { createFileRoute } from '@tanstack/react-router'
import type { ConnectorError } from '@garden/core/connectors/errors'
import { appEnv } from '@/lib/server/env'
import { json, requireWorkspaceAccess } from '@/lib/server/control-plane'
import { parseJsonBody } from '@/lib/server/validation/common'
import {
  isConnectorError,
  loadWorkProductWorkspace,
  reviewWorkProduct,
  workProductReviewBodySchema,
} from '@/lib/server/work-products'

function statusForConnectorError(error: ConnectorError) {
  switch (error.kind) {
    case 'auth_expired':
      return 401
    case 'permission_denied':
      return 403
    case 'not_found':
      return 404
    case 'rate_limited':
      return 429
    case 'transient':
      return 503
    case 'unknown':
      return 502
  }
}

function connectorErrorBody(error: ConnectorError) {
  return {
    error: `Connector write failed: ${error.kind}`,
    connector_error: error,
  }
}

export const Route = createFileRoute('/api/work-products/$id/review')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const bodyResult = await parseJsonBody(
          request,
          workProductReviewBodySchema,
          'Invalid work product review payload',
        )
        if (bodyResult.isErr()) {
          return json({ error: bodyResult.error.message }, 400)
        }

        const workspaceResult = await loadWorkProductWorkspace({
          env: appEnv,
          workProductId: params.id,
        })
        if (workspaceResult.isErr()) {
          return json(
            { error: workspaceResult.error.message },
            workspaceResult.error.status,
          )
        }

        const access = await requireWorkspaceAccess(
          request,
          workspaceResult.value.workspaceId,
        )
        if (access instanceof Response) return access

        const reviewResult = await reviewWorkProduct({
          actorUserId: access.session.user.id,
          env: appEnv,
          input: bodyResult.value,
          workProductId: params.id,
          workspaceId: workspaceResult.value.workspaceId,
        })
        if (reviewResult.isErr()) {
          if (isConnectorError(reviewResult.error)) {
            return json(
              connectorErrorBody(reviewResult.error),
              statusForConnectorError(reviewResult.error),
            )
          }

          return json(
            { error: reviewResult.error.message },
            reviewResult.error.status,
          )
        }

        return Response.json(reviewResult.value)
      },
    },
  },
})
