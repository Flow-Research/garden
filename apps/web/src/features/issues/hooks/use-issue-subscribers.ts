import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { issueSubscribersOptions } from '@/lib/issues/queries'
import { useToggleIssueSubscriber } from '@/lib/issues/mutations'

export function useIssueSubscribers(issueId: string, userId?: string) {
  const { data: subscribers = [], isLoading: loading } = useQuery(
    issueSubscribersOptions(issueId),
  )

  const toggleMutation = useToggleIssueSubscriber(issueId)


  // --- Mutations ---

  const isSubscribed = subscribers.some(
    (s) => s.user_type === 'member' && s.user_id === userId,
  )

  const toggleSubscriber = useCallback(
    async (
      subUserId: string,
      userType: 'member' | 'agent',
      currentlySubscribed: boolean,
    ) => {
      toggleMutation.mutate({
        userId: subUserId,
        userType,
        subscribed: currentlySubscribed,
      })
    },
    [toggleMutation],
  )

  const toggleSubscribe = useCallback(() => {
    if (userId) toggleSubscriber(userId, 'member', isSubscribed)
  }, [userId, isSubscribed, toggleSubscriber])

  return {
    subscribers,
    loading,
    isSubscribed,
    toggleSubscribe,
    toggleSubscriber,
  }
}
