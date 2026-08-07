import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  automationErr,
  automationOk,
  ensureAgentInWorkspace,
  listAutomationRuns,
  listAutomationTriggers,
  requireAutomation,
  syncAutomationSchedules,
  toAutomation,
  toAutomationRun,
  toAutomationTrigger,
  uninstallAutomationSchedules,
} from '@/lib/server/automations'
import { notFound, requireWorkspaceAccess } from '@/lib/server/control-plane'
import {
  parseJsonBody,
  updateAutomationBodySchema,
} from '@/lib/server/validation/automations'

export const Route = createFileRoute('/api/automations/$id')({
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
        const runsResult = await listAutomationRuns({
          env: appEnv,
          automationId: automation.id,
          limit: 25,
        })
        if (runsResult.isErr()) return automationErr(runsResult.error)

        return automationOk({
          automation: toAutomation(automation),
          triggers: triggersResult.value.map(toAutomationTrigger),
          runs: runsResult.value.map((run) => toAutomationRun(run)),
        })
      },
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
          updateAutomationBodySchema,
          'Invalid automation payload',
        )
        if (bodyResult.isErr()) return automationErr(bodyResult.error.message)
        const body = bodyResult.value
        if (body.concurrency_policy === 'queue') {
          return automationErr(
            'Automation queue concurrency is not implemented',
          )
        }
        if (body.assignee_agent_id) {
          const agentResult = await ensureAgentInWorkspace({
            env: appEnv,
            workspaceId: automation.workspaceId,
            agentId: body.assignee_agent_id,
          })
          if (agentResult.isErr()) return automationErr(agentResult.error)
        }

        const values: Partial<typeof schema.automation.$inferInsert> = {}
        if (typeof body.title === 'string') values.title = body.title
        if (Object.prototype.hasOwnProperty.call(body, 'description')) {
          values.description = body.description ?? null
        }
        if (body.assignee_agent_id)
          values.assigneeAgentId = body.assignee_agent_id
        if (body.priority) values.priority = body.priority
        if (Object.prototype.hasOwnProperty.call(body, 'project_id')) {
          values.projectId = body.project_id ?? null
        }
        if (body.status) values.status = body.status
        if (body.concurrency_policy) {
          values.concurrencyPolicy = body.concurrency_policy
        }

        if (Object.prototype.hasOwnProperty.call(body, 'system_prompt')) {
          values.systemPrompt = body.system_prompt ?? null
        }
        if (Object.prototype.hasOwnProperty.call(body, 'input_schema')) {
          values.inputSchema = body.input_schema ?? null
        }
        if (Object.prototype.hasOwnProperty.call(body, 'context_sources')) {
          values.contextSources = body.context_sources ?? null
        }
        if (Object.prototype.hasOwnProperty.call(body, 'output_config')) {
          values.outputConfig = body.output_config ?? null
        }
        if (Object.prototype.hasOwnProperty.call(body, 'execution_config')) {
          values.executionConfig = body.execution_config ?? null
        }
        if (Object.prototype.hasOwnProperty.call(body, 'notification_config')) {
          values.notificationConfig = body.notification_config ?? null
        }
        if (Object.prototype.hasOwnProperty.call(body, 'scheduling_config')) {
          values.schedulingConfig = body.scheduling_config ?? null
        }
        if (body.tags) values.tags = body.tags
        if (Object.prototype.hasOwnProperty.call(body, 'category')) {
          values.category = body.category ?? null
        }
        if (Object.prototype.hasOwnProperty.call(body, 'template_source')) {
          values.templateSource = body.template_source ?? null
        }
        if (Object.prototype.hasOwnProperty.call(body, 'metadata')) {
          values.metadata = body.metadata ?? null
        }

        if (Object.keys(values).length === 0) {
          return automationErr('No valid automation changes submitted')
        }
        values.updatedAt = new Date()
        values.updatedBy = access.session.user.id

        const db = await appContext.db()
        const [updated] = await db
          .update(schema.automation)
          .set(values)
          .where(eq(schema.automation.id, automation.id))
          .returning()
        if (!updated) return notFound('Automation not found')

        const syncResult =
          updated.status === 'active'
            ? await syncAutomationSchedules(appEnv, updated)
            : await uninstallAutomationSchedules(appEnv, updated.id)
        if (syncResult.isErr()) return automationErr(syncResult.error)

        return automationOk(toAutomation(updated))
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
        const [updated] = await db
          .update(schema.automation)
          .set({ status: 'archived', updatedAt: new Date() })
          .where(eq(schema.automation.id, automation.id))
          .returning()
        if (!updated) return notFound('Automation not found')

        const uninstallResult = await uninstallAutomationSchedules(
          appEnv,
          automation.id,
        )
        if (uninstallResult.isErr()) return automationErr(uninstallResult.error)

        return automationOk(toAutomation(updated))
      },
    },
  },
})
