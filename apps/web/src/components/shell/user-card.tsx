import { useState } from 'react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@garden/ui/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@garden/ui/components/ui/dropdown-menu'
import { cn } from '@garden/ui/lib/utils'
import type { Workspace } from '@garden/core/types'
import {
  Building2,
  ChevronRight,
  ChevronsUpDown,
  Check,
  Copy,
  Settings,
  Send,
  Plus,
  LogOut,
  Monitor,
  MoonStar,
  Sun,
} from 'lucide-react'
import type { MemberRole } from '@garden/core/types'

/**
 * Account flyout — the sidebar's bottom user card per the design's
 * User-profile_Flyout (Penpot "Admin Profile" page): profile header, User ID
 * copy + role badge, stacked Settings and Invite members rows, a Theme icon
 * toggle (System/Light/Dark), an expandable "Workspaces" row that carries
 * workspace switching + creation, and Sign out. The card itself shows avatar +
 * name only; the role badge is exclusive to the flyout's User ID row.
 */

const themeOptions = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: MoonStar },
] as const

export function UserCard({
  user,
  role,
  workspaces,
  currentWorkspaceId,
  collapsed,
  onAccount,
  onInviteMembers,
  onLogout,
  onSwitchWorkspace,
  onCreateWorkspace,
  onRefreshWorkspaces,
}: {
  user: { id: string; name: string; email: string; avatar?: string | null }
  role: MemberRole | null
  workspaces: Workspace[]
  currentWorkspaceId?: string | null
  collapsed?: boolean
  onAccount: () => void
  onInviteMembers: () => void
  onLogout: () => void
  onSwitchWorkspace: (workspace: Workspace) => void
  onCreateWorkspace: () => void
  onRefreshWorkspaces: () => void
}) {
  const { theme, setTheme } = useTheme()
  const [flyoutOpen, setFlyoutOpen] = useState(false)
  const [workspacesOpen, setWorkspacesOpen] = useState(false)
  const initials = user.name
    .split(' ')
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const copyUserId = () => {
    // Undefined in non-secure contexts (http over LAN IP) — guard or the click throws synchronously.
    const clipboard = navigator.clipboard
    if (!clipboard) {
      toast.error('Copy unavailable in this browser context')
      return
    }
    void clipboard.writeText(user.id).then(
      () => toast.success('User ID copied'),
      () => toast.error('Copy failed'),
    )
  }

  /** Dismiss-then-act: these rows are custom markup, not Menu.Item, so Base UI never auto-closes the flyout on activation. */
  const runAndClose = (action: () => void) => () => {
    setFlyoutOpen(false)
    action()
  }

  return (
    <DropdownMenu
      open={flyoutOpen}
      onOpenChange={(open) => {
        setFlyoutOpen(open)
        if (!open) setWorkspacesOpen(false)
      }}
    >
      <DropdownMenuTrigger
        aria-label="Account"
        className={cn(
          'cursor-pointer flex w-full items-center gap-2 rounded-sm p-2 text-left transition-colors hover:bg-background-main-secondary',
          collapsed && 'justify-center p-0',
        )}
      >
        <Avatar className="size-6 rounded-sm">
          <AvatarImage src={user.avatar ?? undefined} alt={user.name} />
          <AvatarFallback className="rounded-sm text-[10px]">
            {initials}
          </AvatarFallback>
        </Avatar>
        {!collapsed ? (
          <>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-neutral-default">
              {user.name}
            </span>
            {/* Role badge lives only in the expanded flyout (User ID row);
                the collapsed profile strip stays avatar + name. */}
            <ChevronsUpDown className="size-3.5 shrink-0 text-icon-neutral-tertiary" />
          </>
        ) : null}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        className="w-[288px] max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl p-0 shadow-5"
        side="top"
        align="start"
        sideOffset={8}
      >
        {/* Profile header */}
        <div className="flex items-center gap-2.5 bg-background-main-secondary px-4 pt-3.5 pb-3">
          <Avatar className="size-9 rounded-sm">
            <AvatarImage src={user.avatar ?? undefined} alt={user.name} />
            <AvatarFallback className="rounded-sm">{initials}</AvatarFallback>
          </Avatar>
          <div className="grid min-w-0 flex-1 text-left leading-tight">
            <span className="truncate text-sm font-semibold text-text-neutral-default">
              {user.name}
            </span>
            <span className="truncate text-xs text-text-secondary">
              {user.email}
            </span>
          </div>
        </div>

        {/* User ID + role */}
        <div className="flex items-center gap-2 border-t border-border-default bg-background-main-secondary px-4 py-2.5">
          <span className="text-xs text-text-secondary">
            User ID:{' '}
            <span className="text-text-neutral-default">
              {redactUserId(user.id)}
            </span>
          </span>
          <button
            type="button"
            onClick={copyUserId}
            aria-label="Copy user ID"
            className="cursor-pointer flex size-5 items-center justify-center rounded-xs text-icon-neutral-tertiary transition-colors hover:bg-background-main-secondary hover:text-icon-neutral-default"
          >
            <Copy className="size-3" />
          </button>
          {role ? (
            <span className="ml-auto rounded-pill bg-badge-blue-background px-2 py-0.5 text-xs font-medium text-badge-blue-text">
              {roleLabel(role)}
            </span>
          ) : null}
        </div>

        {/* Settings + Invite */}
        <button
          type="button"
          onClick={runAndClose(onAccount)}
          className={cn(MENU_ROW_CLASS_NAME, 'border-t border-border-default')}
        >
          <Settings className="size-4 text-icon-neutral-secondary" />
          Settings
        </button>
        <button
          type="button"
          onClick={runAndClose(onInviteMembers)}
          className={MENU_ROW_CLASS_NAME}
        >
          <Send className="size-4 text-icon-neutral-secondary" />
          Invite members
        </button>

        {/* Theme */}
        <div className="flex items-center justify-between border-t border-border-default px-4 py-2.5">
          <p className="text-xs font-medium tracking-[0.12em] text-text-secondary uppercase">
            Theme
          </p>
          <div
            role="radiogroup"
            aria-label="Theme"
            className="flex gap-0.5 rounded-pill border border-border-default bg-background-main-secondary p-0.5"
          >
            {themeOptions.map((opt) => {
              const active = theme === opt.value
              const Icon = opt.icon
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={opt.label}
                  title={opt.label}
                  onClick={() => setTheme(opt.value)}
                  className={cn(
                    'flex size-7 cursor-pointer items-center justify-center rounded-full transition-colors',
                    active
                      ? 'bg-background-main-default text-text-neutral-default shadow-1'
                      : 'text-icon-neutral-tertiary hover:text-text-neutral-default',
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                </button>
              )
            })}
          </div>
        </div>

        {/* Workspaces (expandable — carries switching + creation) */}
        <div className="border-t border-border-default">
          <button
            type="button"
            onClick={() => {
              // Keep the warm list visible while discovering memberships added
              // in another tab. Opening previously never refreshed this cache.
              if (!workspacesOpen) onRefreshWorkspaces()
              setWorkspacesOpen((value) => !value)
            }}
            aria-expanded={workspacesOpen}
            className={MENU_ROW_CLASS_NAME}
          >
            <Building2 className="size-4 text-icon-neutral-secondary" />
            <span className="flex-1 text-left">Workspaces</span>
            <ChevronRight
              className={cn(
                'size-3.5 text-icon-neutral-tertiary transition-transform',
                workspacesOpen && 'rotate-90',
              )}
            />
          </button>
          {workspacesOpen ? (
            <div className="px-4 pb-3">
              <div className="max-h-40 overflow-y-auto">
                {workspaces.map((workspace) => {
                  const active = workspace.id === currentWorkspaceId
                  return (
                    <button
                      key={workspace.id}
                      type="button"
                      disabled={active}
                      onClick={runAndClose(() => onSwitchWorkspace(workspace))}
                      className="cursor-pointer flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-text-neutral-default transition-colors hover:bg-background-main-secondary disabled:opacity-60"
                    >
                      <Building2 className="size-4 shrink-0 text-icon-neutral-tertiary" />
                      <span className="min-w-0 flex-1 truncate">
                        {workspace.name}
                      </span>
                      {active ? (
                        <Check className="size-3.5 text-icon-success-default" />
                      ) : null}
                    </button>
                  )
                })}
              </div>
              <button
                type="button"
                onClick={runAndClose(onCreateWorkspace)}
                className="mt-1 flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-text-brand-secondary transition-colors hover:bg-background-main-secondary"
              >
                <Plus className="size-4" />
                New workspace
              </button>
            </div>
          ) : null}
        </div>

        {/* Sign out */}
        <button
          type="button"
          onClick={runAndClose(onLogout)}
          className={cn(MENU_ROW_CLASS_NAME, 'border-t border-border-default')}
        >
          <LogOut className="size-4 text-icon-neutral-secondary" />
          Sign out
        </button>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Masks the middle of the user id in the UI (first 8 … last 4). The full id
 * still lands on the clipboard via the copy button.
 */
const MENU_ROW_CLASS_NAME =
  'cursor-pointer flex h-10 w-full items-center gap-3 px-2 text-sm tracking-wider text-text-neutral-default transition-colors hover:bg-background-main-secondary [&_svg]:size-[18px]'

function redactUserId(id: string) {
  if (id.length <= 12) return id
  return `${id.slice(0, 8)}…${id.slice(-4)}`
}

function roleLabel(role: MemberRole) {
  return role === 'owner' ? 'Owner' : role === 'admin' ? 'Admin' : 'Member'
}
