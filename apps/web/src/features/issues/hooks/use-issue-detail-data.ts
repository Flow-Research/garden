import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@garden/app-state/auth'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { useActorName } from '@/lib/workspace/hooks'
import { useWorkspaceId } from '@garden/app-state/hooks'
import {
  issueKeys,
  issueDetailOptions,
  childIssuesOptions,
  issueUsageOptions,
} from '@/lib/issues/queries'
import { memberListOptions, agentListOptions } from '@/lib/workspace/queries'
import { useRecentIssuesStore } from '@garden/app-state/issues/stores/recent-issues-store'
import { useIssueTimeline } from './use-issue-timeline'
import { useIssueReactions } from './use-issue-reactions'
import { useIssueSubscribers } from './use-issue-subscribers'
import { useAttachmentUpload } from '@/lib/hooks/use-attachment-upload'
import { useDeleteIssue, useUpdateIssue } from '@/lib/issues/mutations'
import type { Issue, ListIssuesResponse } from '@garden/core/types'
import { isMissingError } from '@/lib/api/errors'

/**
 * Loads issue-detail dependencies without subscribing the detail panel to the
 * whole issue board. Before this change, opening a detail mounted
 * issueListOptions(wsId), which could kick broad list work during panel open.
 * Now the detail query is still workspace-scoped for cache safety, but seeds
 * from any existing detail/list cache snapshot through QueryClient only. Ref:
 * TanStack Query initialData/cache guidance in the local query skill docs.
 */
export function useIssueDetailData(issueId: string) {
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.user)
  const userId = useAuthStore((state) => state.user?.id)
  const workspace = useWorkspaceStore((state) => state.workspace)
  const wsId = useWorkspaceId()
  const { data: members = [] } = useQuery(memberListOptions(wsId))
  const { data: agents = [] } = useQuery(agentListOptions(wsId))
  const currentMemberRole = members.find(
    (member) => member.user_id === user?.id,
  )?.role
  const { getActorName } = useActorName()
  const { uploadWithToast } = useAttachmentUpload()

  const getCachedIssue = (id: string | null | undefined): Issue | undefined => {
    if (!id) return undefined
    return (
      queryClient.getQueryData<Issue>(issueKeys.detail(wsId, id)) ??
      queryClient
        .getQueryData<ListIssuesResponse>(issueKeys.list(wsId))
        ?.issues.find((candidate) => candidate.id === id)
    )
  }

  const issueQuery = useQuery({
    ...issueDetailOptions(wsId, issueId),
    initialData: () => getCachedIssue(issueId),
  })
  const issue = issueQuery.data ?? null
  const issueLoading = issueQuery.isLoading
  // Only a 404 or 403 means the issue is gone. Any other failure used to show
  // "does not exist or has been deleted" too, with no way to retry.
  const issueLoadFailed =
    issueQuery.isError && !issue && !isMissingError(issueQuery.error)
  const retryIssue = () => void issueQuery.refetch()
  const retryingIssue = issueQuery.isFetching

  const recordVisit = useRecentIssuesStore((state) => state.recordVisit)
  useEffect(() => {
    if (issue) {
      recordVisit(issue.id)
    }
  }, [issue?.id, recordVisit, issue])

  const timelineState = useIssueTimeline(issueId, user?.id)
  const issueReactionState = useIssueReactions(issueId, user?.id)
  const subscriberState = useIssueSubscribers(issueId, user?.id)
  const { data: usage } = useQuery(issueUsageOptions(issueId))
  const parentIssueId = issue?.parent_issue_id
  const { data: parentIssue = null } = useQuery({
    ...issueDetailOptions(wsId, parentIssueId ?? ''),
    enabled: !!parentIssueId,
    initialData: () => getCachedIssue(parentIssueId),
  })
  const { data: childIssues = [] } = useQuery({
    ...childIssuesOptions(wsId, issueId),
    enabled: !!issue,
  })
  const { data: parentChildIssues = [] } = useQuery({
    ...childIssuesOptions(wsId, parentIssueId ?? ''),
    enabled: !!parentIssueId,
  })

  return {
    user,
    userId,
    workspace,
    wsId,
    members,
    agents,
    currentMemberRole,
    getActorName,
    uploadWithToast,
    issue,
    issueLoading,
    issueLoadFailed,
    retryIssue,
    retryingIssue,
    timelineState,
    issueReactionState,
    subscriberState,
    usage,
    parentIssueId,
    parentIssue,
    childIssues,
    parentChildIssues,
    updateIssueMutation: useUpdateIssue(),
    deleteIssueMutation: useDeleteIssue(),
  }
}
