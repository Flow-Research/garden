import {
  Alert02Icon,
  BubbleChatIcon,
  Cards02Icon,
  ChartRelationshipIcon,
  CheckListIcon,
  FolderLibraryIcon,
  Home04Icon,
  InboxIcon,
  Robot01Icon,
  UserMultiple02Icon,
  WorkflowSquare10Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import type { ComponentType } from 'react'

type NavIcon = ComponentType<{ className?: string }>

/** Adapts Hugeicons' data-driven icon to the sidebar's `icon` component prop. */
function hugeicon(icon: IconSvgElement): NavIcon {
  const NavHugeicon = ({ className }: { className?: string }) => (
    <HugeiconsIcon icon={icon} className={className} />
  )
  return NavHugeicon
}

/**
 * Primary nav config for the redesigned shell (Penpot "Garden" file, 2026-09).
 * Single source of truth for sidebar labels/icons/routes — the product renames
 * agreed with design matching the Penpot sidebar exactly (Home, Chats, Tasks, Files & Folders,
 * Inbox, Workflows, Agents, Skills, Connectors, Teams). Icons come from the free
 * Hugeicons set (`@hugeicons/core-free-icons`).
 */
export type NavItem = {
  id: string
  label: string
  /** Route base path; used for active-state matching and navigation. */
  to: string
  icon: NavIcon
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Home', to: '/home', icon: hugeicon(Home04Icon) },
  { id: 'chats', label: 'Chats', to: '/chats', icon: hugeicon(BubbleChatIcon) },
  { id: 'tasks', label: 'Tasks', to: '/tasks', icon: hugeicon(CheckListIcon) },
  // Design spec: office / regular / folders
  {
    id: 'files',
    label: 'Files & Folders',
    to: '/files',
    icon: hugeicon(FolderLibraryIcon),
  },
  { id: 'inbox', label: 'Inbox', to: '/inbox', icon: hugeicon(InboxIcon) },
  {
    id: 'automations',
    label: 'Workflows',
    to: '/workflows',
    icon: hugeicon(WorkflowSquare10Icon),
  },
  { id: 'agents', label: 'Agents', to: '/agents', icon: hugeicon(Robot01Icon) },
  {
    id: 'skills',
    label: 'Skills',
    to: '/skills',
    icon: hugeicon(Cards02Icon),
  },
  {
    id: 'connections',
    label: 'Connectors',
    to: '/connectors',
    icon: hugeicon(ChartRelationshipIcon),
  },
  {
    id: 'teams',
    label: 'Teams',
    to: '/teams',
    icon: hugeicon(UserMultiple02Icon),
  },
]

/**
 * Admin-only Teams dropdown child (Penpot Teams_Main `Items`): the cross-team
 * Issues surface, which toggles between list and board in place. Members keep
 * the flat Teams item and reach their work through the member Teams view.
 */
export const TEAM_NAV_CHILDREN: NavItem[] = [
  {
    id: 'teams-issues',
    label: 'Issues',
    to: '/teams/issues',
    icon: hugeicon(Alert02Icon),
  },
]

/** Resolves the nav child that owns a pathname (exact route-base match). */
export function teamNavChildForPathname(pathname: string): NavItem | null {
  return (
    TEAM_NAV_CHILDREN.find(
      (item) => pathname === item.to || pathname.startsWith(`${item.to}/`),
    ) ?? null
  )
}

/** Resolves the nav item that owns a pathname (longest route-base match). */
export function navItemForPathname(pathname: string): NavItem | null {
  let best: NavItem | null = null
  for (const item of NAV_ITEMS) {
    if (pathname === item.to || pathname.startsWith(`${item.to}/`)) {
      if (!best || item.to.length > best.to.length) best = item
    }
  }
  return best
}
