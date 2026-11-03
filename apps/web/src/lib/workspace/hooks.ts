import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { memberListOptions, agentListOptions } from './queries'

/**
 * Actor name, initials and avatar lookups for the workspace. The functions
 * are memoized on the member and agent lists, so they keep their identity
 * between renders (they were new every render, re-rendering every memoized
 * consumer), and look up by id in maps instead of scanning the lists.
 */
export function useActorName() {
  const wsId = useWorkspaceId()
  const { data: members } = useQuery(memberListOptions(wsId))
  const { data: agents } = useQuery(agentListOptions(wsId))

  return useMemo(() => {
    const membersById = new Map(
      (members ?? []).map((member) => [member.user_id, member]),
    )
    const agentsById = new Map((agents ?? []).map((agent) => [agent.id, agent]))

    const getMemberName = (userId: string) =>
      membersById.get(userId)?.name ?? 'Unknown'

    const getAgentName = (agentId: string) =>
      agentsById.get(agentId)?.name ?? 'Unknown Agent'

    const getActorName = (type: string, id: string) => {
      if (type === 'member') return getMemberName(id)
      if (type === 'agent') return getAgentName(id)
      return 'System'
    }

    const getActorInitials = (type: string, id: string) =>
      getActorName(type, id)
        .split(' ')
        .map((w) => w[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)

    const getActorAvatarUrl = (type: string, id: string): string | null => {
      if (type === 'member') return membersById.get(id)?.avatar_url ?? null
      if (type === 'agent') return agentsById.get(id)?.avatar_url ?? null
      return null
    }

    return {
      getMemberName,
      getAgentName,
      getActorName,
      getActorInitials,
      getActorAvatarUrl,
    }
  }, [members, agents])
}
