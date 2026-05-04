'use client'

import {
  GitBranch,
  HelpCircle,
  Octagon,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@garden/ui/components/ui/popover'
import { cn } from '@garden/ui/lib/utils'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AgentCapabilityPopoverProps {
  agentName: string
  agentRole?: string | null
  agentIcon?: string | null
  /**
   * Optional list of skill slugs assigned to this agent. Renders below the
   * core capabilities so the user can see what extra abilities Bot picked up.
   */
  assignedSkills?: { slug: string; name: string; description?: string }[]
  /**
   * Trigger element — usually the agent's name or avatar. Passed through
   * base-ui Popover's `render` prop so the trigger itself is the user's
   * element (no nested-button HTML).
   */
  trigger: React.ReactElement
  /** Side the popover opens. Defaults to bottom. */
  side?: 'top' | 'bottom' | 'left' | 'right'
  /** Compact variant — drops the long descriptions, keeps the headlines. */
  compact?: boolean
  /**
   * When true, render the engineering metadata (tool names like
   * `ask_question`, `create_work_product`). Off by default per the plan's
   * quiet floor — users see capability *behavior*, not tool implementation.
   */
  debugMode?: boolean
}

// ─── Capability rows ─────────────────────────────────────────────────────────

const CORE_CAPABILITIES = [
  {
    icon: HelpCircle,
    title: 'Ask',
    body: 'One focused question with chips when the answer space is small. Free-text fallback always.',
    tool: 'ask_question',
  },
  {
    icon: Sparkles,
    title: 'Produce',
    body: 'Briefs, plans, drafts, PRs, reports, checklists. Full deliverables, not narration.',
    tool: 'create_work_product',
  },
  {
    icon: GitBranch,
    title: 'Decompose',
    body: 'Break work into sub-issues with their own assignees. Parent stays in flight.',
    tool: 'create_child_issue',
  },
  {
    icon: ShieldCheck,
    title: 'Request approval',
    body: 'External writes (Slack reply, GitHub comment, Drive edit) pause for your approval automatically.',
    tool: '(MCP gate)',
  },
  {
    icon: Octagon,
    title: 'Block',
    body: 'Hard stop with a concrete reason when an external dependency can\'t be satisfied.',
    tool: 'mark_blocked',
  },
] as const

// ─── Component ───────────────────────────────────────────────────────────────

export function AgentCapabilityPopover({
  agentName,
  agentRole,
  agentIcon,
  assignedSkills = [],
  trigger,
  side = 'bottom',
  compact = false,
  debugMode = false,
}: AgentCapabilityPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger render={trigger} />
      <PopoverContent
        side={side}
        align="start"
        sideOffset={6}
        className="w-[320px] p-0"
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-border/50 px-4 py-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/40 text-base">
            {agentIcon ?? '🤖'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground">
              {agentName}
            </div>
            {agentRole && (
              <div className="text-[11px] text-muted-foreground">{agentRole}</div>
            )}
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">
              What this agent can do
            </div>
          </div>
        </div>

        {/* Capabilities */}
        <ul className="divide-y divide-border/30">
          {CORE_CAPABILITIES.map(({ icon: Icon, title, body, tool }) => (
            <li
              key={title}
              className="flex items-start gap-2.5 px-4 py-2.5 transition-colors hover:bg-foreground/[0.015]"
            >
              <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12px] font-medium text-foreground">
                    {title}
                  </span>
                  {debugMode && (
                    <code
                      className={cn(
                        'shrink-0 font-mono text-[10px] text-muted-foreground/70',
                        tool.startsWith('(') && 'italic',
                      )}
                    >
                      {tool}
                    </code>
                  )}
                </div>
                {!compact && (
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    {body}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>

        {/* Assigned skills */}
        {assignedSkills.length > 0 && (
          <div className="border-t border-border/40 bg-muted/20 px-4 py-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">
              + {assignedSkills.length} skill{assignedSkills.length === 1 ? '' : 's'}
            </div>
            <ul className="mt-1.5 space-y-1">
              {assignedSkills.map((s) => (
                <li
                  key={s.slug}
                  className="flex items-baseline gap-2 text-[11px]"
                  title={s.description}
                >
                  <span className="size-1 shrink-0 rounded-full bg-foreground/40" />
                  <span className="font-medium text-foreground/85">
                    {s.name}
                  </span>
                  {s.description && (
                    <span className="truncate text-muted-foreground">
                      · {s.description}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-border/40 px-4 py-2 text-[10.5px] leading-relaxed text-muted-foreground">
          Bot decides per turn which to use. You always have the final say on
          deliverables and external writes.
        </div>
      </PopoverContent>
    </Popover>
  )
}
