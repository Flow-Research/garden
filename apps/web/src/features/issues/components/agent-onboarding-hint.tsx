import { useState } from 'react'
import {
  GitBranch,
  HelpCircle,
  Octagon,
  Sparkles,
  X,
} from 'lucide-react'
import { cn } from '@garden/ui/lib/utils'
import { Button } from '@garden/ui/components/ui/button'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AgentOnboardingHintProps {
  /** Display name of the freshly-assigned agent. */
  agentName: string
  /** Optional role title, surfaces under the name. */
  agentRole?: string | null
  /** Avatar URL or emoji (single grapheme rendered in the badge). */
  agentIcon?: string | null
  /**
   * Called when the user dismisses the hint. Caller should persist the
   * dismissal so it doesn't render again for this (user, agent) pair.
   */
  onDismiss?: () => void
  /** Compact variant — drops the capability list, just shows the headline. */
  compact?: boolean
}

// ─── Capabilities ────────────────────────────────────────────────────────────

const CAPABILITIES = [
  {
    icon: HelpCircle,
    title: 'Asks one focused question',
    body: 'Pick a chip or type your own answer.',
  },
  {
    icon: Sparkles,
    title: 'Produces work products',
    body: 'Briefs, plans, drafts, PRs. Approve or request changes.',
  },
  {
    icon: GitBranch,
    title: 'Decomposes into sub-issues',
    body: 'Splits big work into children, tracked on the right.',
  },
  {
    icon: Octagon,
    title: 'Marks blocked when stuck',
    body: 'Names the blocker instead of spinning silently.',
  },
] as const

// ─── Card ────────────────────────────────────────────────────────────────────

export function AgentOnboardingHint({
  agentName,
  agentRole,
  agentIcon,
  onDismiss,
  compact = false,
}: AgentOnboardingHintProps) {
  const [closing, setClosing] = useState(false)

  const handleDismiss = () => {
    setClosing(true)
    // Let the fade play before yanking the node.
    setTimeout(() => onDismiss?.(), 180)
  }

  return (
    <div
      data-onboarding-hint
      className={cn(
        'relative overflow-hidden rounded-lg border border-info/25 bg-gradient-to-br from-info/[0.06] via-info/[0.02] to-transparent transition-opacity duration-200',
        closing && 'opacity-0',
      )}
    >
      {/* Diagonal sparkle texture — subtle, just a hint that something new is here */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-0 top-0 size-32 translate-x-12 -translate-y-8 rounded-full bg-info/[0.08] blur-3xl"
      />

      <div className="relative flex items-start gap-3 px-4 py-3.5">
        {/* Agent badge */}
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-info/30 bg-info/10 text-base">
          {agentIcon ?? '🤖'}
        </div>

        {/* Headline */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-info/80">
              New assignee
            </span>
          </div>
          <h3 className="mt-0.5 text-sm font-semibold text-foreground">
            <span className="text-foreground">{agentName}</span>
            {agentRole && (
              <span className="ml-1.5 text-[12px] font-normal text-muted-foreground">
                · {agentRole}
              </span>
            )}{' '}
            <span className="text-muted-foreground/70 font-normal">is on this issue.</span>
          </h3>
          {!compact && (
            <p className="mt-1 max-w-prose text-[12.5px] leading-relaxed text-muted-foreground">
              Here's what {agentName} can do.
            </p>
          )}
        </div>

        {/* Dismiss */}
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handleDismiss}
          aria-label="Dismiss onboarding hint"
          className="shrink-0 text-muted-foreground/60"
        >
          <X />
        </Button>
      </div>

      {/* Capability list */}
      {!compact && (
        <div className="relative grid grid-cols-1 gap-px border-t border-info/15 bg-info/[0.02] sm:grid-cols-2">
          {CAPABILITIES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="flex items-start gap-2.5 bg-background/40 px-4 py-2.5"
            >
              <Icon className="mt-0.5 size-3.5 shrink-0 text-info/80" />
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-foreground">
                  {title}
                </div>
                <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  {body}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer hint */}
      {!compact && (
        <div className="relative border-t border-info/15 bg-background/30 px-4 py-2 text-[11px] text-muted-foreground">
          Reassign to another agent or a teammate anytime.
        </div>
      )}
    </div>
  )
}
