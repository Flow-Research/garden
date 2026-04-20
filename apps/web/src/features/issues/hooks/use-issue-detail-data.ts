'use client'

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@garden/core/api'
import { useAuthStore } from '@garden/core/auth'
import { useWorkspaceStore } from '@garden/core/workspace'
import { useActorName } from '@garden/core/workspace/hooks'
import { useWorkspaceId } from '@garden/core/hooks'
import {
  issueListOptions,
  issueDetailOptions,
  childIssuesOptions,
  issueUsageOptions,
} from '@garden/core/issues/queries'
import {
  memberListOptions,
  agentListOptions,
} from '@garden/core/workspace/queries'
import { useRecentIssuesStore } from '@garden/core/issues/stores'
import { useIssueTimeline } from './use-issue-timeline'
import { useIssueReactions } from './use-issue-reactions'
import { useIssueSubscribers } from './use-issue-subscribers'
import { useFileUpload } from '@garden/core/hooks/use-file-upload'
import { pinListOptions, useCreatePin, useDeletePin } from '@garden/core/pins'
import {
  useDeleteIssue,
  useUpdateIssue,
} from '@garden/core/issues/mutations'

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
      const cached = allIssues.find((candidate) => candidate.id === issueId)
      return cached?.description != null ? cached : undefined
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
  const { data: pinnedItems = [] } = useQuery({
    ...pinListOptions(wsId, userId ?? ''),
    enabled: !!userId,
  })

  const createPin = useCreatePin()
  const deletePin = useDeletePin()
  const isPinned = pinnedItems.some(
    (pinned) => pinned.item_type === 'issue' && pinned.item_id === issueId,
  )

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
    createPin,
    deletePin,
    isPinned,
    parentIssueId,
    parentIssue,
    childIssues,
    parentChildIssues,
    updateIssueMutation: useUpdateIssue(),
    deleteIssueMutation: useDeleteIssue(),
  }
}
