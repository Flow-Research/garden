import { MessageSquare, Mail, FileText, Sparkles, Bot } from 'lucide-react'
import { cn } from '@garden/ui/lib/utils'

type ConnectorId =
  | 'github'
  | 'slack'
  | 'gmail'
  | 'google_drive'
  | 'manual'
  | 'agent'

interface ConnectorIconProps {
  connectorId: string
  className?: string
  size?: number
}

function GithubIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path
        d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 18c-4.51 2-5-2-7-2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const ICONS: Record<
  ConnectorId,
  React.ComponentType<React.SVGProps<SVGSVGElement>>
> = {
  github: GithubIcon,
  slack: MessageSquare,
  gmail: Mail,
  google_drive: FileText,
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
