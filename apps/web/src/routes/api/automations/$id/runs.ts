import { createFileRoute } from '@tanstack/react-router'
import { appEnv } from '@/lib/server/env'
import {
  automationErr,
  automationOk,
  listAutomationRuns,
  requireAutomation,
  toAutomationRun,
} from '@/lib/server/automations'
import { notFound, requireWorkspaceAccess } from '@/lib/server/control-plane'
import {
  automationRunsListSearchSchema,
  parseSearchParams,
} from '@/lib/server/validation/automations'

export const Route = createFileRoute('/api/automations/$id/runs')({
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

        const searchResult = parseSearchParams(
          request,
          automationRunsListSearchSchema,
          'Invalid automation runs query',
        )
        if (searchResult.isErr())
          return automationErr(searchResult.error.message)

        const runsResult = await listAutomationRuns({
          env: appEnv,
          automationId: automation.id,
          source: searchResult.value.source,
          limit: searchResult.value.limit,
          offset: searchResult.value.offset,
        })
        if (runsResult.isErr()) return automationErr(runsResult.error)

        return automationOk(
          runsResult.value.map((run) =>
            toAutomationRun(run, { debug: searchResult.value.debug }),
          ),
        )
      },
    },
  },
})
