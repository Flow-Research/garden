import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { ReactRenderer } from '@tiptap/react'
import { computePosition, offset, flip, shift } from '@floating-ui/dom'
import type { QueryClient } from '@tanstack/react-query'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { issueKeys } from '@/lib/issues/queries'
import { workspaceKeys } from '@/lib/workspace/queries'
import type {
  Issue,
  ListIssuesResponse,
  MemberWithUser,
  Agent,
} from '@garden/core/types'
import { ActorAvatar } from '../../common/actor-avatar'
import { StatusIcon } from '../../issues/components/status-icon'
import { Badge } from '@garden/ui/components/ui/badge'
import type { IssueStatus } from '@garden/core/types'
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MentionItem {
  id: string
  label: string
  type: 'member' | 'agent' | 'issue' | 'all'
  /** Secondary text shown beside the label (e.g. issue title) */
  description?: string
  /** Issue status for StatusIcon rendering */
  status?: IssueStatus
}

interface MentionListProps {
  items: MentionItem[]
  command: (item: MentionItem) => void
}

export interface MentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

// ---------------------------------------------------------------------------
// Group items by section
// ---------------------------------------------------------------------------

interface MentionGroup {
  label: string
  items: MentionItem[]
}

function groupItems(items: MentionItem[]): MentionGroup[] {
  const members: MentionItem[] = []
  const agents: MentionItem[] = []
  const issues: MentionItem[] = []

  for (const item of items) {
    if (item.type === 'issue') issues.push(item)
    else if (item.type === 'agent') agents.push(item)
    else members.push(item)
  }

  const groups: MentionGroup[] = []
  if (members.length > 0) groups.push({ label: 'Members', items: members })
  if (agents.length > 0) groups.push({ label: 'Agents', items: agents })
  if (issues.length > 0) groups.push({ label: 'Issues', items: issues })
  return groups
}

// ---------------------------------------------------------------------------
// MentionList — the popup rendered inside the editor
// ---------------------------------------------------------------------------

const MentionList = forwardRef<MentionListRef, MentionListProps>(
  function MentionList({ items, command }, ref) {
    const [selectedKey, setSelectedKey] = useState<string | null>(null)
    const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
    const requestedIndex = selectedKey
      ? items.findIndex((item) => `${item.type}:${item.id}` === selectedKey)
      : -1
    const selectedIndex = requestedIndex >= 0 ? requestedIndex : 0

    const moveSelection = useCallback(
      (nextIndex: number) => {
        const item = items[nextIndex]
        setSelectedKey(item ? `${item.type}:${item.id}` : null)
        requestAnimationFrame(() => {
          itemRefs.current[nextIndex]?.scrollIntoView({ block: 'nearest' })
        })
      },
      [items],
    )

    const selectItem = useCallback(
      (index: number) => {
        const item = items[index]
        if (item) command(item)
      },
      [items, command],
    )

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (items.length === 0) return false
        if (event.key === 'ArrowUp') {
          moveSelection((selectedIndex + items.length - 1) % items.length)
          return true
        }
        if (event.key === 'ArrowDown') {
          moveSelection((selectedIndex + 1) % items.length)
          return true
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          selectItem(selectedIndex)
          return true
        }
        return false
      },
    }))

    if (items.length === 0) {
      return (
        <div className="rounded-xl bg-popover p-2 text-xs text-muted-foreground shadow-[var(--shadow-float-1)]">
          No members, agents, or issues found
        </div>
      )
    }

    const groups = groupItems(items)

    // Build a flat index mapping: globalIndex → item
    let globalIndex = 0

    return (
      <div
        role="listbox"
        aria-label="Mention suggestions"
        className="max-h-[300px] w-72 overflow-y-auto rounded-xl bg-popover py-1 shadow-[var(--shadow-float-1)]"
      >
        {groups.map((group) => (
          <div key={group.label}>
            <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
              {group.label}
            </div>
            {group.items.map((item) => {
              const idx = globalIndex++
              return (
                <MentionRow
                  key={`${item.type}-${item.id}`}
                  item={item}
                  selected={idx === selectedIndex}
                  onSelect={() => selectItem(idx)}
                  buttonRef={(el) => {
                    itemRefs.current[idx] = el
                  }}
                />
              )
            })}
          </div>
        ))}
      </div>
    )
  },
)

// ---------------------------------------------------------------------------
// MentionRow — single item in the list
// ---------------------------------------------------------------------------

function MentionRow({
  item,
  selected,
  onSelect,
  buttonRef,
}: {
  item: MentionItem
  selected: boolean
  onSelect: () => void
  buttonRef: (el: HTMLButtonElement | null) => void
}) {
  if (item.type === 'issue') {
    return (
      <button
        ref={buttonRef}
        type="button"
        role="option"
        aria-selected={selected}
        className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition-colors ${
          selected ? 'bg-accent' : 'hover:bg-accent/50'
        }`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onSelect}
      >
        {item.status && (
          <StatusIcon status={item.status} className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="shrink-0 text-muted-foreground">{item.label}</span>
        {item.description && (
          <span className="truncate text-muted-foreground">
            {item.description}
          </span>
        )}
      </button>
    )
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      role="option"
      aria-selected={selected}
      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition-colors ${
        selected ? 'bg-accent' : 'hover:bg-accent/50'
      }`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
    >
      <ActorAvatar
        actorType={item.type === 'all' ? 'member' : item.type}
        actorId={item.id}
        size={20}
      />
      <span className="truncate font-medium">{item.label}</span>
      {item.type === 'agent' && (
        <Badge variant="outline" className="ml-auto text-[10px] h-4 px-1.5">
          Agent
        </Badge>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Suggestion config factory
// ---------------------------------------------------------------------------

export function createMentionSuggestion(
  qc: QueryClient,
): Omit<SuggestionOptions<MentionItem>, 'editor'> {
  return {
    items: ({ query }) => {
      const wsId = useWorkspaceStore.getState().workspace?.id
      const members: MemberWithUser[] = wsId
        ? (qc.getQueryData(workspaceKeys.members(wsId)) ?? [])
        : []
      const agents: Agent[] = wsId
        ? (qc.getQueryData(workspaceKeys.agents(wsId)) ?? [])
        : []
      const issues: Issue[] = wsId
        ? (qc.getQueryData<ListIssuesResponse>(issueKeys.list(wsId))?.issues ??
          [])
        : []

      const q = query.trim().toLocaleLowerCase()

      // Show "All members" option when query is empty or matches "all"
      const allItem: MentionItem[] =
        'all members'.includes(q) || 'all'.includes(q)
          ? [{ id: 'all', label: 'All members', type: 'all' as const }]
          : []

      const memberItems: MentionItem[] = members
        .filter(
          (member) =>
            member.name.toLocaleLowerCase().includes(q) ||
            member.email.toLocaleLowerCase().includes(q),
        )
        .map((m) => ({
          id: m.user_id,
          label: m.name,
          type: 'member' as const,
        }))

      const agentItems: MentionItem[] = agents
        .filter((a) => !a.archived_at && a.name.toLowerCase().includes(q))
        .map((a) => ({ id: a.id, label: a.name, type: 'agent' as const }))

      const issueItems: MentionItem[] = issues
        .filter(
          (i) =>
            i.identifier.toLowerCase().includes(q) ||
            i.title.toLowerCase().includes(q),
        )
        .map((i) => ({
          id: i.id,
          label: i.identifier,
          type: 'issue' as const,
          description: i.title,
          status: i.status as IssueStatus,
        }))

      return [...allItem, ...memberItems, ...agentItems, ...issueItems].slice(
        0,
        12,
      )
    },

    render: () => {
      let renderer: ReactRenderer<MentionListRef> | null = null
      let popup: HTMLDivElement | null = null

      return {
        onStart: (props: SuggestionProps<MentionItem>) => {
          renderer = new ReactRenderer(MentionList, {
            props: { items: props.items, command: props.command },
            editor: props.editor,
          })

          popup = document.createElement('div')
          popup.style.position = 'fixed'
          popup.style.zIndex = '50'
          popup.appendChild(renderer.element)
          document.body.appendChild(popup)

          updatePosition(popup, props.clientRect)
        },

        onUpdate: (props: SuggestionProps<MentionItem>) => {
          renderer?.updateProps({
            items: props.items,
            command: props.command,
          })
          if (popup) updatePosition(popup, props.clientRect)
        },

        onKeyDown: (props: { event: KeyboardEvent }) => {
          if (props.event.key === 'Escape') {
            cleanup()
            return true
          }
          return renderer?.ref?.onKeyDown(props) ?? false
        },

        onExit: () => {
          cleanup()
        },
      }

      function updatePosition(
        el: HTMLDivElement,
        clientRect: (() => DOMRect | null) | null | undefined,
      ) {
        if (!clientRect) return
        const virtualEl = {
          getBoundingClientRect: () => clientRect() ?? new DOMRect(),
        }
        computePosition(virtualEl, el, {
          placement: 'bottom-start',
          strategy: 'fixed',
          middleware: [offset(4), flip(), shift({ padding: 8 })],
        }).then(({ x, y }) => {
          el.style.left = `${x}px`
          el.style.top = `${y}px`
        })
      }

      function cleanup() {
        renderer?.destroy()
        renderer = null
        popup?.remove()
        popup = null
      }
    },
  }
}
