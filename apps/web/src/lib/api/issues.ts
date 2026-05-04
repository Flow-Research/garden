import type {
  AssigneeFrequencyEntry,
  Comment,
  CreateIssueRequest,
  Issue,
  IssueReaction,
  IssueRun,
  IssueRunEvent,
  IssueSubscriber,
  IssueUsageSummary,
  IssueWorkProduct,
  ListIssuesParams,
  ListIssuesResponse,
  Reaction,
  SearchIssuesResponse,
  TimelineEntry,
  UpdateIssueRequest,
} from '@garden/core/types'
import { getApiTransport } from './state'

export function listIssues(params?: ListIssuesParams): Promise<ListIssuesResponse> {
  const search = new URLSearchParams()
  if (params?.limit) search.set('limit', String(params.limit))
  if (params?.offset) search.set('offset', String(params.offset))
  if (params?.workspace_id) search.set('workspace_id', params.workspace_id)
  if (params?.status) search.set('status', params.status)
  if (params?.priority) search.set('priority', params.priority)
  if (params?.assignee_id) search.set('assignee_id', params.assignee_id)
  if (params?.assignee_ids?.length) {
    search.set('assignee_ids', params.assignee_ids.join(','))
  }
  if (params?.creator_id) search.set('creator_id', params.creator_id)
  if (params?.open_only) search.set('open_only', 'true')
  return getApiTransport().request(`/api/issues?${search}`)
}

export function searchIssues(params: {
  q: string
  limit?: number
  offset?: number
  include_closed?: boolean
  signal?: AbortSignal
}): Promise<SearchIssuesResponse> {
  const search = new URLSearchParams({ q: params.q })
  if (params.limit !== undefined) search.set('limit', String(params.limit))
  if (params.offset !== undefined) search.set('offset', String(params.offset))
  if (params.include_closed) search.set('include_closed', 'true')
  return getApiTransport().request(
    `/api/issues/search?${search}`,
    params.signal ? { signal: params.signal } : undefined,
  )
}

export function getIssue(id: string): Promise<Issue> {
  return getApiTransport().request(`/api/issues/${id}`)
}

export function createIssue(data: CreateIssueRequest): Promise<Issue> {
  return getApiTransport().request('/api/issues', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function updateIssue(id: string, data: UpdateIssueRequest): Promise<Issue> {
  return getApiTransport().request(`/api/issues/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export function listChildIssues(id: string): Promise<{ issues: Issue[] }> {
  return getApiTransport().request(`/api/issues/${id}/children`)
}

export function getChildIssueProgress(): Promise<{
  progress: { parent_issue_id: string; total: number; done: number }[]
}> {
  return getApiTransport().request('/api/issues/child-progress')
}

export function deleteIssue(id: string): Promise<void> {
  return getApiTransport().request(`/api/issues/${id}`, { method: 'DELETE' })
}

export async function batchUpdateIssues(
  issueIds: string[],
  updates: UpdateIssueRequest,
): Promise<{ updated: number }> {
  await Promise.all(issueIds.map((id) => updateIssue(id, updates)))
  return { updated: issueIds.length }
}

export async function batchDeleteIssues(
  issueIds: string[],
): Promise<{ deleted: number }> {
  await Promise.all(issueIds.map((id) => deleteIssue(id)))
  return { deleted: issueIds.length }
}

export function createComment(
  issueId: string,
  content: string,
  type?: string,
  parentId?: string,
  attachmentIds?: string[],
): Promise<Comment> {
  return getApiTransport().request(`/api/issues/${issueId}/comments`, {
    method: 'POST',
    body: JSON.stringify({
      content,
      type: type ?? 'comment',
      ...(parentId ? { parent_id: parentId } : {}),
      ...(attachmentIds?.length ? { attachment_ids: attachmentIds } : {}),
    }),
  })
}

export function listTimeline(issueId: string): Promise<TimelineEntry[]> {
  return getApiTransport().request(`/api/issues/${issueId}/timeline`)
}

export function getAssigneeFrequency(): Promise<AssigneeFrequencyEntry[]> {
  return listIssues().then((response) => {
    const counts = new Map<string, AssigneeFrequencyEntry>()
    for (const issue of response.issues) {
      if (!issue.assignee_type || !issue.assignee_id) continue
      const key = `${issue.assignee_type}:${issue.assignee_id}`
      const current = counts.get(key)
      if (current) {
        current.frequency += 1
      } else {
        counts.set(key, {
          assignee_type: issue.assignee_type,
          assignee_id: issue.assignee_id,
          frequency: 1,
        })
      }
    }
    return [...counts.values()]
  })
}

export function updateComment(commentId: string, content: string): Promise<Comment> {
  return getApiTransport().request(`/api/comments/${commentId}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  })
}

export function deleteComment(commentId: string): Promise<void> {
  return getApiTransport().request(`/api/comments/${commentId}`, {
    method: 'DELETE',
  })
}

export function addReaction(commentId: string, emoji: string): Promise<Reaction> {
  return getApiTransport().request(`/api/comments/${commentId}/reactions`, {
    method: 'POST',
    body: JSON.stringify({ emoji }),
  })
}

export function removeReaction(commentId: string, emoji: string): Promise<void> {
  return getApiTransport().request(`/api/comments/${commentId}/reactions`, {
    method: 'DELETE',
    body: JSON.stringify({ emoji }),
  })
}

export function addIssueReaction(
  issueId: string,
  emoji: string,
): Promise<IssueReaction> {
  return getApiTransport().request(`/api/issues/${issueId}/reactions`, {
    method: 'POST',
    body: JSON.stringify({ emoji }),
  })
}

export function removeIssueReaction(issueId: string, emoji: string): Promise<void> {
  return getApiTransport().request(`/api/issues/${issueId}/reactions`, {
    method: 'DELETE',
    body: JSON.stringify({ emoji }),
  })
}

export function listIssueSubscribers(issueId: string): Promise<IssueSubscriber[]> {
  return getApiTransport().request(`/api/issues/${issueId}/subscribers`)
}

export function subscribeToIssue(
  issueId: string,
  userId?: string,
  userType?: string,
): Promise<void> {
  const body: Record<string, string> = {}
  if (userId) body.user_id = userId
  if (userType) body.user_type = userType
  return getApiTransport().request(`/api/issues/${issueId}/subscribe`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function unsubscribeFromIssue(
  issueId: string,
  userId?: string,
  userType?: string,
): Promise<void> {
  const body: Record<string, string> = {}
  if (userId) body.user_id = userId
  if (userType) body.user_type = userType
  return getApiTransport().request(`/api/issues/${issueId}/unsubscribe`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function listRuns(issueId: string) {
  return getApiTransport().request<IssueRun[]>(`/api/issues/${issueId}/runs`)
}

export function manualRun(
  issueId: string,
) {
  return getApiTransport().request(`/api/issues/${issueId}/runs`, {
    method: 'POST',
  })
}

export function getActiveRun(issueId: string): Promise<{
  run: IssueRun | null
  work_products: IssueWorkProduct[]
  events: IssueRunEvent[]
}> {
  return getApiTransport().request(`/api/issues/${issueId}/active-run`)
}

export function getRunEvents(
  issueId: string,
  params?: { run_id?: string; after?: number; limit?: number },
): Promise<IssueRunEvent[]> {
  const search = new URLSearchParams()
  if (params?.run_id) search.set('run_id', params.run_id)
  if (params?.after !== undefined) search.set('after', String(params.after))
  if (params?.limit !== undefined) search.set('limit', String(params.limit))
  const suffix = search.size > 0 ? `?${search}` : ''
  return getApiTransport().request(`/api/issues/${issueId}/events${suffix}`)
}

export function cancelRun(issueId: string) {
  return getApiTransport().request(`/api/issues/${issueId}/cancel`, {
    method: 'POST',
  })
}

export function getIssueUsage(issueId: string): Promise<IssueUsageSummary> {
  return getApiTransport().request(`/api/issues/${issueId}/usage`)
}
