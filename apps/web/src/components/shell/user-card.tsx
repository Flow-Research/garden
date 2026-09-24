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
  Buildings,
  CaretRight,
  CaretUpDown,
  Check,
  Copy,
  Gear,
  PaperPlaneTilt,
  Plus,
  SignOut,
} from '@phosphor-icons/react'
import type { MemberRole } from '@garden/core/types'

/**
 * Account flyout — the sidebar's bottom user card per the design's
 * User-profile_Flyout (Penpot "Admin Profile" page): profile header, User ID
 * copy + role badge, Settings / Invite members actions, Theme segmented
 * control (System/Light/Dark), an expandable "Workspaces" row that carries
 * workspace switching + creation, and Sign out. The card itself shows avatar +
 * name only; the role badge is exclusive to the flyout's User ID row.
 */

const themeOptions = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
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
            <CaretUpDown className="size-3.5 shrink-0 text-icon-neutral-tertiary" />
          </>
        ) : null}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        className="w-[378px] overflow-hidden rounded-xl p-0 shadow-5"
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
        <div className="flex gap-2 border-t border-border-default px-4 py-3">
          <button
            type="button"
            onClick={runAndClose(onAccount)}
            className="cursor-pointer flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-border-default bg-background-main-default text-sm whitespace-nowrap text-text-neutral-default shadow-1 transition-colors hover:bg-background-main-secondary"
          >
            <Gear className="size-4 text-icon-neutral-secondary" />
            Settings
          </button>
          <button
            type="button"
            onClick={runAndClose(onInviteMembers)}
            className="cursor-pointer flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-border-default bg-background-main-default text-sm whitespace-nowrap text-text-neutral-default shadow-1 transition-colors hover:bg-background-main-secondary"
          >
            <PaperPlaneTilt className="size-4 text-icon-neutral-secondary" />
            Invite members
          </button>
        </div>

        {/* Theme */}
        <div className="border-t border-border-default px-4 py-3">
          <p className="mb-2 text-xs text-text-secondary">Theme</p>
          <div
            role="radiogroup"
            aria-label="Theme"
            className="cursor-pointer flex rounded-md bg-background-main-secondary p-0.5"
          >
            {themeOptions.map((opt) => {
              const active = theme === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setTheme(opt.value)}
                  className={cn(
                    'h-7 flex-1 cursor-pointer rounded-[5px] text-sm transition-colors',
                    active
                      ? 'bg-background-brand-default font-medium text-text-brand-on-brand'
                      : 'text-text-secondary hover:text-text-neutral-default',
                  )}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Workspaces (expandable — carries switching + creation) */}
        <div className="border-t border-border-default">
          <button
            type="button"
            onClick={() => setWorkspacesOpen((value) => !value)}
            aria-expanded={workspacesOpen}
            className="cursor-pointer flex h-10 w-full items-center gap-3 px-2 text-sm tracking-wider text-text-neutral-default transition-colors hover:bg-background-main-secondary [&_svg]:size-[18px]"
          >
            <Buildings className="size-4 text-icon-neutral-secondary" />
            <span className="flex-1 text-left">Workspaces</span>
            <CaretRight
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
                      <Buildings className="size-4 shrink-0 text-icon-neutral-tertiary" />
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
          className="cursor-pointer flex h-10 w-full items-center gap-3 border-t border-border-default px-2 text-sm tracking-wider text-text-neutral-default transition-colors hover:bg-background-main-secondary [&_svg]:size-[18px]"
        >
          <SignOut className="size-4 text-icon-neutral-secondary" />
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
function redactUserId(id: string) {
  if (id.length <= 12) return id
  return `${id.slice(0, 8)}…${id.slice(-4)}`
}

function roleLabel(role: MemberRole) {
  return role === 'owner' ? 'Owner' : role === 'admin' ? 'Admin' : 'Member'
}
