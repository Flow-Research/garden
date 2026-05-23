'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { Result } from 'better-result'
import { toast } from 'sonner'
import {
  IconBook,
  IconLayoutDashboard,
  IconInbox,
  IconKeyboard,
  IconMessageCircle,
  IconRobot,
  IconSearch,
  IconSettings,
  IconSettingsCog,
  IconSparkles,
  type Icon,
} from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useRecentIssuesStore } from '@garden/core/issues/stores'
import { issueListOptions } from '@/lib/issues/queries'
import { useWorkspaceId } from '@garden/core/hooks'
import { STATUS_CONFIG } from '@garden/core/issues/config'
import { StatusIcon } from '../issues/components'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@garden/ui/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@garden/ui/components/ui/dialog'
import { Kbd, KbdGroup } from '@garden/ui/components/ui/kbd'
import { Loader2 } from 'lucide-react'
import {
  useWorkspaceDock,
  type WorkspacePanelKind,
} from '@/components/shell/workspace-dock'
import { useAgentSessions } from '@/features/chat/use-agent-chat-sessions'
import { useSettingsDialogStore } from '@/features/settings'
import { useSearchStore } from './search-store'
import { useIssueSearch } from '@/features/issues/hooks/use-issue-search'

function HighlightText({ text, query }: { text: string; query: string }) {
  const parts = useMemo(() => {
    if (!query.trim()) return [{ text, highlight: false }]
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`(${escaped})`, 'gi')
    const result: { text: string; highlight: boolean }[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        result.push({
          text: text.slice(lastIndex, match.index),
          highlight: false,
        })
      }
      result.push({ text: match[0], highlight: true })
      lastIndex = regex.lastIndex
    }
    if (lastIndex < text.length) {
      result.push({ text: text.slice(lastIndex), highlight: false })
    }
    return result.length > 0 ? result : [{ text, highlight: false }]
  }, [text, query])

  return (
    <>
      {parts.map((part, i) =>
        part.highlight ? (
          <mark
            key={i}
            className="rounded-sm bg-yellow-200 text-inherit dark:bg-yellow-900/60"
          >
            {part.text}
          </mark>
        ) : (
          part.text
        ),
      )}
    </>
  )
}

interface NavPage {
  kind: WorkspacePanelKind
  title: string
  label: string
  icon: Icon
  keywords: string[]
  shortcut?: readonly string[]
}

const navPages: NavPage[] = [
  {
    kind: 'dashboard',
    title: 'Dashboard',
    label: 'Dashboard',
    icon: IconLayoutDashboard,
    keywords: ['dashboard', 'home', 'overview', 'workspace'],
  },
  {
    kind: 'inbox',
    title: 'Inbox',
    label: 'Inbox',
    icon: IconInbox,
    keywords: ['inbox', 'notifications', 'home'],
  },
  {
    kind: 'issues',
    title: 'Tasks',
    label: 'Tasks',
    icon: IconSparkles,
    keywords: ['issues', 'tasks', 'board', 'work'],
  },
  {
    kind: 'chat',
    title: 'New Chat',
    label: 'Chat',
    icon: IconMessageCircle,
    keywords: ['chat', 'agent', 'conversation'],
  },
  {
    kind: 'chat',
    title: 'Agent Chat',
    label: 'Agent Chat',
    icon: IconRobot,
    keywords: ['agent', 'assistant', 'chat'],
  },
  {
    kind: 'skill-editor',
    title: 'Skills',
    label: 'Skills',
    icon: IconBook,
    keywords: ['skills', 'knowledge', 'library'],
  },
  {
    kind: 'capabilities',
    title: 'Connections',
    label: 'Connections',
    icon: IconSettingsCog,
    keywords: ['connections', 'capabilities', 'permissions'],
  },
]

interface QuickAction {
  id: string
  label: string
  icon: Icon
  shortcut?: readonly string[]
  onSelect: (ctx: { setOpen: (open: boolean) => void }) => void
}

const ITEM_CLASS = 'mx-2 rounded-lg py-2.5'

export function SearchCommand() {
  const dock = useWorkspaceDock()
  const openPanel = useCallback(
    (...args: Parameters<NonNullable<typeof dock>['openPanel']>) =>
      dock?.openPanel(...args) ?? null,
    [dock],
  )
  const { claimWarmSession } = useAgentSessions()
  const openSettingsDialog = useSettingsDialogStore((s) => s.openSettings)
  const open = useSearchStore((s) => s.open)
  const setOpen = useSearchStore((s) => s.setOpen)
  const recentItems = useRecentIssuesStore((s) => s.items)
  const wsId = useWorkspaceId()
  const { data: allIssues = [] } = useQuery(issueListOptions(wsId))

  const recentIssues = useMemo(() => {
    const issueMap = new Map(allIssues.map((i) => [i.id, i]))
    return recentItems.flatMap((item) => {
      const issue = issueMap.get(item.id)
      return issue ? [issue] : []
    })
  }, [recentItems, allIssues])

  const { query, results, isLoading, setQuery, reset } = useIssueSearch()

  const filteredPages = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return navPages.filter(
      (page) =>
        page.label.toLowerCase().includes(q) ||
        page.keywords.some((kw) => kw.includes(q)),
    )
  }, [query])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        useSearchStore.getState().toggle()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    if (!open) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('keydown', handleEsc, true)
    return () => document.removeEventListener('keydown', handleEsc, true)
  }, [open, setOpen])

  useEffect(() => {
    if (!open) {
      reset()
    }
  }, [open, reset])

  const handleValueChange = useCallback(
    (value: string) => {
      setQuery(value)
    },
    [setQuery],
  )

  const openIssue = useCallback(
    (issueId: string, title: string) => {
      setOpen(false)
      openPanel({
        kind: 'issue-detail',
        title,
        entityId: issueId,
      })
    },
    [openPanel, setOpen],
  )

  const openPage = useCallback(
    (page: NavPage) => {
      setOpen(false)
      if (page.kind === 'chat') {
        void Result.tryPromise(() => claimWarmSession()).then((result) => {
          if (Result.isError(result)) {
            toast.error(
              result.error instanceof Error
                ? result.error.message
                : 'Failed to start chat',
            )
            return
          }
          openPanel({
            kind: 'chat',
            title: result.value.title,
            entityId: result.value.id,
          })
        })
        return
      }
      openPanel({ kind: page.kind, title: page.title })
    },
    [claimWarmSession, openPanel, setOpen],
  )

  const quickActions: QuickAction[] = useMemo(
    () => [
      {
        id: 'open-chat',
        label: 'Start a Chat',
        icon: IconMessageCircle,
        shortcut: ['C'],
        onSelect: ({ setOpen }) => {
          setOpen(false)
          void Result.tryPromise(() => claimWarmSession()).then((result) => {
            if (Result.isError(result)) {
              toast.error(
                result.error instanceof Error
                  ? result.error.message
                  : 'Failed to start chat',
              )
              return
            }
            openPanel({
              kind: 'chat',
              title: result.value.title,
              entityId: result.value.id,
            })
          })
        },
      },
      {
        id: 'open-settings',
        label: 'Open Settings',
        icon: IconSettings,
        shortcut: ['⌘', ','],
        onSelect: ({ setOpen }) => {
          setOpen(false)
          openSettingsDialog()
        },
      },
    ],
    [claimWarmSession, openPanel, openSettingsDialog],
  )

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogHeader className="sr-only">
        <DialogTitle>Command Menu</DialogTitle>
        <DialogDescription>
          Search issues or open workspace panels.
        </DialogDescription>
      </DialogHeader>
      <DialogContent
        className="top-[20%] translate-y-0 gap-0 overflow-hidden rounded-xl border-border/50 p-0 shadow-lg sm:max-w-xl!"
        finalFocus={false}
        showCloseButton={false}
      >
        <Command
          shouldFilter={false}
          className="flex h-full w-full flex-col overflow-hidden bg-popover **:data-[slot=command-input-wrapper]:h-auto **:data-[slot=command-input-wrapper]:grow **:data-[slot=command-input-wrapper]:border-0 **:data-[slot=command-input-wrapper]:px-0"
        >
          <div className="flex h-12 items-center gap-2 border-border/50 border-b px-4">
            <IconSearch
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
            />
            <CommandInput
              className="h-10 text-[15px]"
              onValueChange={handleValueChange}
              placeholder="Search issues or open a panel..."
              value={query}
            />
            <button
              className="flex shrink-0 items-center"
              onClick={() => setOpen(false)}
              type="button"
            >
              <Kbd>Esc</Kbd>
            </button>
          </div>

          <CommandList className="max-h-[min(400px,60vh)] py-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <CommandEmpty>No results found.</CommandEmpty>
            )}

            {filteredPages.length > 0 && (
              <CommandGroup heading="Panels">
                {filteredPages.map((page) => {
                  const Icon = page.icon
                  return (
                    <CommandItem
                      className={ITEM_CLASS}
                      key={page.kind}
                      onSelect={() => openPage(page)}
                      value={`page:${page.kind}`}
                    >
                      <Icon aria-hidden />
                      <span className="truncate">
                        <HighlightText text={page.label} query={query} />
                      </span>
                      {page.shortcut && (
                        <KbdGroup className="ml-auto">
                          {page.shortcut.map((key, i) => (
                            <Kbd key={i}>{key}</Kbd>
                          ))}
                        </KbdGroup>
                      )}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}

            {!isLoading && results.length > 0 && (
              <CommandGroup heading="Issues">
                {results.map((issue) => (
                  <CommandItem
                    className={ITEM_CLASS}
                    key={issue.id}
                    onSelect={() => openIssue(issue.id, issue.title)}
                    value={issue.id}
                  >
                    <StatusIcon
                      status={issue.status}
                      className="size-4 shrink-0"
                    />
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {issue.identifier}
                    </span>
                    <span className="truncate">
                      <HighlightText text={issue.title} query={query} />
                    </span>
                    <span
                      className={`ml-auto shrink-0 text-xs ${STATUS_CONFIG[issue.status].iconColor}`}
                    >
                      {STATUS_CONFIG[issue.status].label}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {!isLoading && !query.trim() && recentIssues.length > 0 && (
              <CommandGroup heading="Recent Issues">
                {recentIssues.map((item) => (
                  <CommandItem
                    className={ITEM_CLASS}
                    key={item.id}
                    onSelect={() => openIssue(item.id, item.title)}
                    value={item.id}
                  >
                    <StatusIcon
                      status={item.status}
                      className="size-4 shrink-0"
                    />
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {item.identifier}
                    </span>
                    <span className="truncate">{item.title}</span>
                    <span
                      className={`ml-auto shrink-0 text-xs ${STATUS_CONFIG[item.status]?.iconColor ?? ''}`}
                    >
                      {STATUS_CONFIG[item.status]?.label ?? ''}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {!isLoading && !query.trim() && (
              <CommandGroup heading="Quick Actions">
                {quickActions.map((action) => {
                  const Icon = action.icon
                  return (
                    <CommandItem
                      className={ITEM_CLASS}
                      key={action.id}
                      onSelect={() => action.onSelect({ setOpen })}
                      value={`action:${action.id}`}
                    >
                      <Icon aria-hidden />
                      <span className="truncate">{action.label}</span>
                      {action.shortcut && (
                        <KbdGroup className="ml-auto">
                          {action.shortcut.map((key, i) => (
                            <Kbd key={i}>{key}</Kbd>
                          ))}
                        </KbdGroup>
                      )}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}

            {!isLoading && !query.trim() && (
              <CommandGroup heading="Help">
                <CommandItem
                  className={ITEM_CLASS}
                  onSelect={() => setOpen(false)}
                  value="keyboard"
                >
                  <IconKeyboard aria-hidden />
                  View Keyboard Shortcuts
                  <KbdGroup className="ml-auto">
                    <Kbd>⌘</Kbd>
                    <Kbd>/</Kbd>
                  </KbdGroup>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
