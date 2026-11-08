import { useCallback, useState } from 'react'
import { Result } from 'better-result'
import { toast } from 'sonner'
import { History } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@garden/ui/components/ui/popover'
import { SurfaceTabs } from '@garden/ui/components/shell/surface-tabs'
import {
  EMPTY_SURFACE_TABS,
  useSurfaceTabsStore,
  withActiveTab,
} from '@garden/app-state/surface-tabs'
import { useSurfaceNavigation } from '@/features/navigation/use-surface-navigation'
import { useAgentSessions } from '@/features/chat/use-agent-chat-sessions'
import { ChatSessionExplorer } from '@/features/chat'

/**
 * Chats surface tab strip: open threads as tabs (design: Chats is one of the
 * two tabbable surfaces; its "+" claims the pre-warmed new chat). Tabs resolve
 * their titles live from the sessions query when possible so renames and
 * first-turn titles appear without a store round-trip.
 */
export function ChatTabsStrip({ activeId }: { activeId: string | null }) {
  const storedTabs = useSurfaceTabsStore(
    (s) => s.bySurface['chats'] ?? EMPTY_SURFACE_TABS,
  )
  const tabs = withActiveTab(storedTabs, activeId)
  const closeTab = useSurfaceTabsStore((s) => s.closeTab)
  const { openChatSession, navigate } = useSurfaceNavigation()
  const { sessions, claimWarmSession } = useAgentSessions()

  const displayTabs = tabs.map((tab) => {
    const live = sessions.find((session) => session.id === tab.id)
    return live ? { ...tab, title: live.title } : tab
  })

  const handleClose = useCallback(
    (id: string) => {
      closeTab('chats', id)
      if (id === activeId) {
        const remaining = tabs.filter((tab) => tab.id !== id)
        const last = remaining[remaining.length - 1]
        if (last) openChatSession(last)
        else void navigate({ to: '/chats' })
      }
    },
    [activeId, closeTab, tabs, openChatSession, navigate],
  )

  const handleNew = useCallback(() => {
    void Result.tryPromise(() => claimWarmSession()).then((result) => {
      if (Result.isError(result)) {
        toast.error(
          result.error instanceof Error
            ? result.error.message
            : 'Failed to start chat',
        )
        return
      }
      openChatSession(result.value)
    })
  }, [claimWarmSession, openChatSession])

  // Explorer rows are plain divs, not Menu.Items — close the popover explicitly on action.
  const [browseOpen, setBrowseOpen] = useState(false)

  return (
    <SurfaceTabs
      tabs={displayTabs}
      activeId={activeId}
      onSelect={(id) => {
        const tab = tabs.find((t) => t.id === id)
        if (tab) openChatSession(tab)
      }}
      onClose={handleClose}
      onNew={handleNew}
      newLabel="New chat"
      end={
        <Popover open={browseOpen} onOpenChange={setBrowseOpen}>
          <PopoverTrigger
            className="ml-auto flex h-6 shrink-0 items-center gap-1.5 rounded-sm px-2 text-xs text-text-secondary transition-colors hover:bg-background-main-secondary hover:text-text-neutral-default"
            aria-label="Browse all chats"
          >
            <History className="size-3.5" />
            Browse
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-1">
            <div className="max-h-96 overflow-y-auto">
              <ChatSessionExplorer
                activeDockSessionId={activeId}
                onActivate={(session) => {
                  setBrowseOpen(false)
                  openChatSession(session)
                }}
                // Archive via handleClose: archiving the ACTIVE session must
                // also navigate away, else /chats/<id> renders blank over a
                // session just removed from the list cache.
                onArchive={(sessionId) => {
                  setBrowseOpen(false)
                  handleClose(sessionId)
                }}
              />
            </div>
          </PopoverContent>
        </Popover>
      }
    />
  )
}
