import { createFileRoute } from '@tanstack/react-router'
import { useSurfaceTabsStore } from '@garden/app-state/surface-tabs'
import { AgentInteractionScreen } from '@/features/chat/components/agent-interaction-screen'

export const Route = createFileRoute('/_authenticated/_app/chats/$threadId')({
  // Client-only tab bookkeeping on direct loads; the strip resolves the real
  // title live. Absent-only upsert — re-upserting would downgrade a real
  // title to this placeholder.
  loader: ({ params }) => {
    if (typeof window === 'undefined') return
    const { bySurface, upsertTab } = useSurfaceTabsStore.getState()
    const tabs = bySurface['chats'] ?? []
    if (tabs.some((tab) => tab.id === params.threadId)) return
    upsertTab('chats', { id: params.threadId, title: 'Chat' })
  },
  component: ChatThreadRoute,
})

function ChatThreadRoute() {
  const { threadId } = Route.useParams()
  return (
    <AgentInteractionScreen
      className="min-h-0 flex-1 bg-background"
      sessionId={threadId}
    />
  )
}
