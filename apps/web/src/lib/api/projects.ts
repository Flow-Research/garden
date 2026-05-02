import type { ListProjectsResponse } from '@garden/core/types'
import { getApiTransport } from './state'

export function listProjects(params?: {
  status?: string
}): Promise<ListProjectsResponse> {
  const search = new URLSearchParams()
  if (params?.status) search.set('status', params.status)
  return getApiTransport().request(`/api/projects?${search}`)
}
