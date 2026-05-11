import { and, desc, eq, sql } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  automationErr,
  automationOk,
  ensureAgentInWorkspace,
  installScheduleTrigger,
  nextRunFromCron,
  toAutomation,
  toAutomationTrigger,
} from '@/lib/server/automations'
import { requireWorkspaceContext } from '@/lib/server/control-plane'
import {
  automationsListSearchSchema,
  createAutomationBodySchema,
  parseJsonBody,
  parseSearchParams,
} from '@/lib/server/validation/automations'

export const Route = createFileRoute('/api/automations')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const context = await requireWorkspaceContext(request, {
          missingWorkspaceResponse: () =>
            automationOk({ automations: [], total: 0 }),
        })
        if (context instanceof Response) return context

        const searchResult = parseSearchParams(
          request,
          automationsListSearchSchema,
          'Invalid automation query',
        )
        if (searchResult.isErr())
          return automationErr(searchResult.error.message)

        const db = getDb(appEnv)
        const conditions = [
          eq(schema.automation.workspaceId, context.workspaceId),
        ]
        if (searchResult.value.status) {
          conditions.push(
            eq(schema.automation.status, searchResult.value.status),
          )
        } else {
          conditions.push(sql`${schema.automation.status} <> 'archived'`)
        }
        const whereClause = and(...conditions)
        const [countRows, rows] = await Promise.all([
          db
            .select({ count: sql<number>`cast(count(*) as int)` })
            .from(schema.automation)
            .where(whereClause),
          db
            .select()
            .from(schema.automation)
            .where(whereClause)
            .orderBy(desc(schema.automation.updatedAt))
            .limit(searchResult.value.limit ?? 50)
            .offset(searchResult.value.offset ?? 0),
        ])

        return automationOk({
          automations: rows.map(toAutomation),
          total: countRows[0]?.count ?? 0,
        })
      },
      POST: async ({ request }) => {
        const context = await requireWorkspaceContext(request)
        if (context instanceof Response) return context

        const bodyResult = await parseJsonBody(
          request,
          createAutomationBodySchema,
          'Invalid automation payload',
        )
        if (bodyResult.isErr()) return automationErr(bodyResult.error.message)
        const body = bodyResult.value
        if (body.concurrency_policy === 'queue') {
          return automationErr(
            'Automation queue concurrency is not implemented',
          )
        }

        const agentResult = await ensureAgentInWorkspace({
          env: appEnv,
          workspaceId: context.workspaceId,
          agentId: body.assignee_agent_id,
        })
        if (agentResult.isErr()) return automationErr(agentResult.error)

        const triggerInput = body.trigger
        const automationStatus = body.status ?? 'active'
        const triggerEnabled = triggerInput?.enabled ?? true
        const nextRunResult =
          triggerInput && automationStatus === 'active' && triggerEnabled
            ? nextRunFromCron({
                cronExpression: triggerInput.cron_expression,
                timezone: triggerInput.timezone,
                from: new Date(),
              })
            : null
        if (nextRunResult?.isErr()) return automationErr(nextRunResult.error)

        const automationId = crypto.randomUUID()
        const triggerId = triggerInput ? crypto.randomUUID() : null
        const db = getDb(appEnv)
        const [automation, trigger] = await db.transaction(async (tx) => {
          const [automationRow] = await tx
            .insert(schema.automation)
            .values({
              id: automationId,
              workspaceId: context.workspaceId,
              projectId: body.project_id ?? null,
              title: body.title,
              description: body.description ?? null,
              issueTitleTemplate: body.issue_title_template ?? null,
              assigneeAgentId: body.assignee_agent_id,
              priority: body.priority ?? 'medium',
              status: automationStatus,
              concurrencyPolicy: body.concurrency_policy ?? 'skip',
              createdBy: context.session.user.id,

              systemPrompt: body.system_prompt ?? null,
              inputSchema: body.input_schema ?? null,
              contextSources: body.context_sources ?? null,
              outputConfig: body.output_config ?? null,
              executionConfig: body.execution_config ?? null,
              notificationConfig: body.notification_config ?? null,
              schedulingConfig: body.scheduling_config ?? null,
              tags: body.tags ?? [],
              category: body.category ?? null,
              templateSource: body.template_source ?? null,
              metadata: body.metadata ?? null,
            })
            .returning()
          if (!triggerInput || !triggerId) return [automationRow, null] as const

          const [triggerRow] = await tx
            .insert(schema.automationTrigger)
            .values({
              id: triggerId,
              automationId,
              kind: 'schedule',
              label: triggerInput.label ?? null,
              enabled: triggerEnabled,
              cronExpression: triggerInput.cron_expression,
              timezone: triggerInput.timezone,
            })
            .returning()
          return [automationRow, triggerRow] as const
        })

        if (trigger) {
          const installResult = await installScheduleTrigger({
            env: appEnv,
            automation,
            trigger,
            nextRunAt: nextRunResult?.isOk() ? nextRunResult.value : undefined,
          })
          if (installResult.isErr()) return automationErr(installResult.error)
        }

        return automationOk(
          {
            automation: toAutomation(automation),
            trigger: trigger ? toAutomationTrigger(trigger) : null,
          },
          201,
        )
      },
    },
  },
})
