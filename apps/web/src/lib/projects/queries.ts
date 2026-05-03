import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'

export const projectKeys = {
  all: (wsId: string) => ['projects', wsId] as const,
  list: (wsId: string) => [...projectKeys.all(wsId), 'list'] as const,
}

export function projectListOptions(wsId: string) {
  return queryOptions({
    queryKey: projectKeys.list(wsId),
    queryFn: () => api.listProjects(),
    select: (data) => data.projects,
  })
}
