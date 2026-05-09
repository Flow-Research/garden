import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'

export const automationKeys = {
  all: (wsId: string) => ['workspaces', wsId, 'automations'] as const,
  list: (wsId: string) => [...automationKeys.all(wsId), 'list'] as const,
  detail: (wsId: string, automationId: string) =>
    [...automationKeys.all(wsId), automationId] as const,
  runs: (wsId: string, automationId: string) =>
    [...automationKeys.detail(wsId, automationId), 'runs'] as const,
}

export function automationListOptions(wsId: string) {
  return queryOptions({
    queryKey: automationKeys.list(wsId),
    queryFn: () => api.listAutomations(),
  })
}

export function automationDetailOptions(wsId: string, automationId: string) {
  return queryOptions({
    queryKey: automationKeys.detail(wsId, automationId),
    queryFn: () => api.getAutomation(automationId),
    enabled: Boolean(automationId),
  })
}

export function automationRunsOptions(wsId: string, automationId: string) {
  return queryOptions({
    queryKey: automationKeys.runs(wsId, automationId),
    queryFn: () => api.listAutomationRuns(automationId),
    enabled: Boolean(automationId),
  })
}
