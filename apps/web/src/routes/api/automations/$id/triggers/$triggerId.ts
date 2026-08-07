import { and, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  automationErr,
  automationOk,
  installScheduleTrigger,
  nextRunFromCron,
  requireAutomation,
  toAutomationTrigger,
  uninstallScheduleTrigger,
} from '@/lib/server/automations'
import { notFound, requireWorkspaceAccess } from '@/lib/server/control-plane'
import {
  parseJsonBody,
  updateAutomationTriggerBodySchema,
} from '@/lib/server/validation/automations'

export const Route = createFileRoute(
  '/api/automations/$id/triggers/$triggerId',
)({
  server: {
    handlers: {
      PATCH: async ({ context, request, params }) => {
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
          updateAutomationTriggerBodySchema,
          'Invalid automation trigger payload',
        )
        if (bodyResult.isErr()) return automationErr(bodyResult.error.message)

        const db = await appContext.db()
        const [existing] = await db
          .select()
          .from(schema.automationTrigger)
          .where(
            and(
              eq(schema.automationTrigger.id, params.triggerId),
              eq(schema.automationTrigger.automationId, automation.id),
            ),
          )
          .limit(1)
        if (!existing) return notFound('Automation trigger not found')
        if (existing.kind !== 'schedule') {
          return automationErr('Only schedule triggers are implemented')
        }

        const body = bodyResult.value
        const nextEnabled = body.enabled ?? existing.enabled
        const nextCron = body.cron_expression ?? existing.cronExpression
        const nextTimezone = body.timezone ?? existing.timezone
        if (!nextCron || !nextTimezone) {
          return automationErr(
            'Schedule trigger requires cron_expression and timezone',
          )
        }

        const nextRunResult =
          automation.status === 'active' && nextEnabled
            ? nextRunFromCron({
                cronExpression: nextCron,
                timezone: nextTimezone,
                from: new Date(),
              })
            : null
        if (nextRunResult?.isErr()) return automationErr(nextRunResult.error)

        const values: Partial<typeof schema.automationTrigger.$inferInsert> = {
          enabled: nextEnabled,
          cronExpression: nextCron,
          timezone: nextTimezone,
          updatedAt: new Date(),
        }
        if (Object.prototype.hasOwnProperty.call(body, 'label')) {
          values.label = body.label ?? null
        }

        const [updated] = await db
          .update(schema.automationTrigger)
          .set(values)
          .where(eq(schema.automationTrigger.id, existing.id))
          .returning()
        if (!updated) return notFound('Automation trigger not found')

        const installResult = await installScheduleTrigger({
          env: appEnv,
          automation,
          trigger: updated,
          nextRunAt: nextRunResult?.isOk() ? nextRunResult.value : undefined,
        })
        if (installResult.isErr()) return automationErr(installResult.error)

        return automationOk(toAutomationTrigger(updated))
      },
      DELETE: async ({ context, request, params }) => {
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

        const db = await appContext.db()
        const [trigger] = await db
          .delete(schema.automationTrigger)
          .where(
            and(
              eq(schema.automationTrigger.id, params.triggerId),
              eq(schema.automationTrigger.automationId, automation.id),
            ),
          )
          .returning()
        if (!trigger) return notFound('Automation trigger not found')

        const uninstallResult = await uninstallScheduleTrigger(
          appEnv,
          trigger.id,
        )
        if (uninstallResult.isErr()) return automationErr(uninstallResult.error)

        return automationOk(toAutomationTrigger(trigger))
      },
    },
  },
})
