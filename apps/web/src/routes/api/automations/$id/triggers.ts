import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  automationErr,
  automationOk,
  installScheduleTrigger,
  listAutomationTriggers,
  nextRunFromCron,
  requireAutomation,
  toAutomationTrigger,
} from '@/lib/server/automations'
import { notFound, requireWorkspaceAccess } from '@/lib/server/control-plane'
import {
  createAutomationTriggerBodySchema,
  parseJsonBody,
} from '@/lib/server/validation/automations'

export const Route = createFileRoute('/api/automations/$id/triggers')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
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

        const triggersResult = await listAutomationTriggers({
          env: appEnv,
          automationId: automation.id,
        })
        if (triggersResult.isErr()) return automationErr(triggersResult.error)
        return automationOk(triggersResult.value.map(toAutomationTrigger))
      },
      POST: async ({ request, params }) => {
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
          createAutomationTriggerBodySchema,
          'Invalid automation trigger payload',
        )
        if (bodyResult.isErr()) return automationErr(bodyResult.error.message)
        const body = bodyResult.value
        const enabled = body.enabled ?? true
        const nextRunResult =
          automation.status === 'active' && enabled
            ? nextRunFromCron({
                cronExpression: body.cron_expression,
                timezone: body.timezone,
                from: new Date(),
              })
            : null
        if (nextRunResult?.isErr()) return automationErr(nextRunResult.error)

        const db = getDb(appEnv)
        const [trigger] = await db
          .insert(schema.automationTrigger)
          .values({
            id: crypto.randomUUID(),
            automationId: automation.id,
            kind: 'schedule',
            enabled,
            label: body.label ?? null,
            cronExpression: body.cron_expression,
            timezone: body.timezone,
            nextRunAt: nextRunResult?.isOk() ? nextRunResult.value : null,
          })
          .returning()

        const installResult = await installScheduleTrigger({
          env: appEnv,
          automation,
          trigger,
          nextRunAt: nextRunResult?.isOk() ? nextRunResult.value : undefined,
        })
        if (installResult.isErr()) return automationErr(installResult.error)

        if (installResult.value) {
          await db
            .update(schema.automationTrigger)
            .set({ nextRunAt: installResult.value, updatedAt: new Date() })
            .where(eq(schema.automationTrigger.id, trigger.id))
        }

        return automationOk(toAutomationTrigger(trigger), 201)
      },
    },
  },
})
