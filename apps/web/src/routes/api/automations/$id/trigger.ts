import { createFileRoute } from '@tanstack/react-router'
import { appEnv } from '@/lib/server/env'
import {
  automationErr,
  automationOk,
  dispatchAutomation,
  requireAutomation,
  toAutomationRun,
} from '@/lib/server/automations'
import { notFound, requireWorkspaceAccess } from '@/lib/server/control-plane'
import { GARDEN_ANALYTICS_EVENTS } from '@garden/observability/analytics/events'
import { capturePostHogEvent } from '@/lib/posthog-server'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  parseJsonBody,
  triggerAutomationBodySchema,
} from '@/lib/server/validation/automations'

export const Route = createFileRoute('/api/automations/$id/trigger')({
  server: {
    handlers: {
      POST: async ({ context, request, params }) => {
        const appContext = requireAppRequestContext(context)
        const automationResult = await requireAutomation(appEnv, params.id)
        if (automationResult.isErr())
          return automationErr(automationResult.error)
        const automation = automationResult.value
        if (!automation) return notFound('Automation not found')

        const access = await requireWorkspaceAccess(
          request,
          automation.workspaceId,
        )
        if (access instanceof Response) return access

        const bodyResult = await parseJsonBody(
          request,
          triggerAutomationBodySchema,
          'Invalid automation trigger payload',
        )
        if (bodyResult.isErr()) return automationErr(bodyResult.error.message)

        const dispatchResult = await dispatchAutomation({
          env: appEnv,
          automation,
          source: bodyResult.value.source ?? 'manual',
          actorId: access.session.user.id,
          payload: bodyResult.value.payload,
        })
        if (dispatchResult.isErr()) return automationErr(dispatchResult.error)

        capturePostHogEvent(appContext, {
          distinctId: access.session.user.id,
          event: GARDEN_ANALYTICS_EVENTS.automationTriggered,
          workspaceId: automation.workspaceId,
          properties: {
            automation_id: automation.id,
            run_id: dispatchResult.value.id,
            source: bodyResult.value.source ?? 'manual',
            outcome: dispatchResult.value.status,
          },
        })
        return automationOk(toAutomationRun(dispatchResult.value), 202)
      },
    },
  },
})
