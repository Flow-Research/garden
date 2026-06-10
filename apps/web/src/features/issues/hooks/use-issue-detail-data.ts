import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuthStore } from '@garden/app-state/auth'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { useActorName } from '@/lib/workspace/hooks'
import { useWorkspaceId } from '@garden/app-state/hooks'
import {
  issueListOptions,
  issueDetailOptions,
  childIssuesOptions,
  issueUsageOptions,
} from '@/lib/issues/queries'
import {
  memberListOptions,
  agentListOptions,
} from '@/lib/workspace/queries'
import { useRecentIssuesStore } from '@garden/app-state/issues/stores/recent-issues-store'
import { useIssueTimeline } from './use-issue-timeline'
import { useIssueReactions } from './use-issue-reactions'
import { useIssueSubscribers } from './use-issue-subscribers'
import { useFileUpload } from '@garden/app-state/hooks/use-file-upload'
import {
  useDeleteIssue,
  useUpdateIssue,
} from '@/lib/issues/mutations'

export function useIssueDetailData(issueId: string) {
  const user = useAuthStore((state) => state.user)
  const userId = useAuthStore((state) => state.user?.id)
  const workspace = useWorkspaceStore((state) => state.workspace)
  const wsId = useWorkspaceId()
  const { data: members = [] } = useQuery(memberListOptions(wsId))
  const { data: agents = [] } = useQuery(agentListOptions(wsId))
  const currentMemberRole = members.find((member) => member.user_id === user?.id)?.role
  const { data: allIssues = [] } = useQuery(issueListOptions(wsId))
  const { getActorName } = useActorName()
  const { uploadWithToast } = useFileUpload(api)

  const { data: issue = null, isLoading: issueLoading } = useQuery({
    ...issueDetailOptions(wsId, issueId),
    initialData: () => {
      return allIssues.find((candidate) => candidate.id === issueId)
    },
  })

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
    initialData: () => allIssues.find((candidate) => candidate.id === parentIssueId),
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
    allIssues,
    getActorName,
    uploadWithToast,
    issue,
    issueLoading,
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
