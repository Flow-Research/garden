import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import type { ConnectorError } from '@garden/core/connectors/errors'
import { GARDEN_ANALYTICS_EVENTS } from '@garden/observability/analytics/events'
import { archiveInboxItemsByKey } from '@garden/db/inbox'
import { appEnv } from '@/lib/server/env'
import {
  capturePostHogEvent,
  capturePostHogHandledError,
} from '@/lib/posthog-server'
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
      POST: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
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
          capturePostHogHandledError(appContext, {
            distinctId: access.session.user.id,
            workspaceId: workspaceResult.value.workspaceId,
            error: isConnectorError(reviewResult.error)
              ? new Error(
                  `Connector write failed: ${reviewResult.error.kind}`,
                  {
                    cause: reviewResult.error,
                  },
                )
              : reviewResult.error,
            properties: {
              operation: 'work_product_review',
              action: bodyResult.value.action,
              work_product_id: params.id,
              issue_id: workspaceResult.value.issueId,
              run_id: workspaceResult.value.runId,
            },
          })
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
        await archiveInboxItemsByKey({
          db: await appContext.db(),
          workspaceId: workspaceResult.value.workspaceId,
          itemKeys: [`wp_review:${params.id}`],
        })

        const comment =
          'comment' in bodyResult.value ? bodyResult.value.comment : undefined
        capturePostHogEvent(appContext, {
          distinctId: access.session.user.id,
          event: GARDEN_ANALYTICS_EVENTS.workProductReviewed,
          workspaceId: workspaceResult.value.workspaceId,
          properties: {
            action: reviewResult.value.action,
            agent_id: workspaceResult.value.agentId,
            issue_id: workspaceResult.value.issueId,
            run_id: workspaceResult.value.runId,
            work_product_id: params.id,
            comment,
            edited_body:
              'edited_body' in bodyResult.value
                ? bodyResult.value.edited_body
                : undefined,
          },
        })

        if (workspaceResult.value.runId) {
          capturePostHogEvent(appContext, {
            distinctId: access.session.user.id,
            event: GARDEN_ANALYTICS_EVENTS.aiMetric,
            workspaceId: workspaceResult.value.workspaceId,
            properties: {
              $ai_trace_id: workspaceResult.value.runId,
              $ai_metric_name: 'garden.work_product_review',
              $ai_metric_value: reviewResult.value.action,
              issue_id: workspaceResult.value.issueId,
              work_product_id: params.id,
            },
          })
          if (comment?.trim()) {
            capturePostHogEvent(appContext, {
              distinctId: access.session.user.id,
              event: GARDEN_ANALYTICS_EVENTS.aiFeedback,
              workspaceId: workspaceResult.value.workspaceId,
              properties: {
                $ai_trace_id: workspaceResult.value.runId,
                $ai_feedback_text: comment,
                issue_id: workspaceResult.value.issueId,
                work_product_id: params.id,
              },
            })
          }
        }

        return Response.json(reviewResult.value)
      },
    },
  },
})
