import { createFileRoute } from '@tanstack/react-router'
import { AgentInteractionScreen } from '@/features/chat/components/agent-interaction-screen'
import { useSurfaceNavigation } from '@/features/navigation/use-surface-navigation'

export const Route = createFileRoute('/_authenticated/_app/chats/')({
  component: ChatsIndexRoute,
})

function ChatsIndexRoute() {
  const { openChatSession } = useSurfaceNavigation()
  // First send materializes the warm draft into a real session — follow it to
  // the thread route so the composer doesn't appear to swallow the message
  // (smoke-observed 2026-09: sending from /chats looked like a vanishing send).
  return (
    <AgentInteractionScreen
      className="min-h-0 flex-1 bg-background"
      onSessionChange={(session) => openChatSession(session)}
    />
  )
}
