import type { ComponentType } from 'react'
import {
  Bot,
  BookOpenText,
  File,
  Inbox,
  LayoutDashboard,
  LayoutList,
  MessageSquare,
  Plug,
  Users,
  Zap,
} from 'lucide-react'
import type { WorkspacePanelKind } from './types'

export const panelIcons: Record<
  WorkspacePanelKind,
  ComponentType<{ className?: string }>
> = {
  blank: File,
  dashboard: LayoutDashboard,
  inbox: Inbox,
  issues: LayoutList,
  'issue-detail': LayoutList,
  automations: Zap,
  'automation-detail': Zap,
  chat: MessageSquare,
  'skill-editor': BookOpenText,
  capabilities: Plug,
  agents: Users,
  'agent-detail': Bot,
}
