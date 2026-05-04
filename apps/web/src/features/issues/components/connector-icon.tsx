'use client'

import { Github, MessageSquare, Mail, FileText, Search, Sparkles, Bot } from 'lucide-react'
import { cn } from '@garden/ui/lib/utils'

type ConnectorId =
  | 'github'
  | 'slack'
  | 'gmail'
  | 'google_drive'
  | 'exa_search'
  | 'manual'
  | 'agent'

interface ConnectorIconProps {
  connectorId: string
  className?: string
  size?: number
}

const ICONS: Record<ConnectorId, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  github: Github,
  slack: MessageSquare,
  gmail: Mail,
  google_drive: FileText,
  exa_search: Search,
  manual: Sparkles,
  agent: Bot,
}

export function ConnectorIcon({
  connectorId,
  className,
  size = 12,
}: ConnectorIconProps) {
  const Icon = ICONS[connectorId as ConnectorId] ?? Sparkles
  return (
    <Icon
      className={cn('shrink-0 text-muted-foreground', className)}
      width={size}
      height={size}
    />
  )
}
