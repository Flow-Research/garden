'use client'

import { useEffect, useState } from 'react'
import { cn } from '@garden/ui/lib/utils'

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * What the agent is doing between turn boundaries. Displayed as a soft
 * secondary line under the active-run header, with a typing-style animated dot.
 *
 * Source for these strings: server-side, derived from the most recent
 * `issue_run_event` payload — `tool_started.tool` for `tool`, otherwise the
 * agent's high-level state. Empty/null = idle (don't render).
 */
export type AgentPresenceKind =
  | 'idle'
  | 'thinking'
  | 'reading'
  | 'writing'
  | 'tool'

export interface AgentPresenceProps {
  kind: AgentPresenceKind
  /** Display name of the agent ("Garden", "Researcher", etc.). */
  agentName?: string
  /** Human label override. Defaults to the canonical text per kind. */
  label?: string
  /** Detail trailing the label (e.g. tool name, source ref). Engineering
   * metadata — only shown when `debugMode` is true. */
  detail?: string | null
  /** Adopt a tighter line-height + font-size when stacked under another row. */
  compact?: boolean
  /**
   * When true, surface engineering-flavored labels ("running tool", "reading")
   * and the `detail` field. When false, fall back to a softer user-facing
   * label ("working") and hide the detail. Off by default per the plan's
   * quiet floor.
   */
  debugMode?: boolean
}

// ─── Defaults ────────────────────────────────────────────────────────────────

/** Engineering-flavored labels — surfaced when debugMode is on. */
const DEBUG_LABEL: Record<AgentPresenceKind, string> = {
  idle: '',
  thinking: 'thinking',
  reading: 'reading',
  writing: 'drafting',
  tool: 'running tool',
}

/** User-facing labels — softer, less specific. Default. */
const QUIET_LABEL: Record<AgentPresenceKind, string> = {
  idle: '',
  thinking: 'thinking',
  reading: 'working',
  writing: 'working',
  tool: 'working',
}

// ─── Animated dots ───────────────────────────────────────────────────────────
//
// Three small dots cycling through opacity. Tighter and less attention-grabbing
// than a spinner. Pure CSS — staggered animation-delay does the work.

function TypingDots({ paused = false }: { paused?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex items-center gap-[3px]',
        paused && '[&>span]:!animation-play-state-paused',
      )}
    >
      <span className="size-[3px] animate-pulse rounded-full bg-info/70 [animation-delay:0ms] [animation-duration:1.2s]" />
      <span className="size-[3px] animate-pulse rounded-full bg-info/70 [animation-delay:200ms] [animation-duration:1.2s]" />
      <span className="size-[3px] animate-pulse rounded-full bg-info/70 [animation-delay:400ms] [animation-duration:1.2s]" />
    </span>
  )
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function AgentPresence({
  kind,
  agentName = 'agent',
  label,
  detail,
  compact = false,
  debugMode = false,
}: AgentPresenceProps) {
  if (kind === 'idle') return null

  const text = label ?? (debugMode ? DEBUG_LABEL[kind] : QUIET_LABEL[kind])

  return (
    <div
      data-presence={kind}
      className={cn(
        'flex items-center gap-1.5 text-muted-foreground',
        compact ? 'text-[11px]' : 'text-xs',
      )}
    >
      <TypingDots />
      <span>
        {agentName} is{' '}
        <span className="text-foreground/75">{text}</span>
        {/* `detail` is engineering metadata (tool name + args); debug-only. */}
        {detail && debugMode && (
          <span className="ml-0.5 font-mono text-[10.5px] text-muted-foreground/70">
            {' '}
            · {detail}
          </span>
        )}
      </span>
    </div>
  )
}

// ─── Demo helper for fixtures ────────────────────────────────────────────────
//
// Cycles through every presence kind once, holding each for ~2.4s. Used in
// the dev showcase + as a fallback when the real WS plumbing isn't ready yet
// (Assumption 10) — gives the UI life without a backend feed.

const DEMO_CYCLE: { kind: AgentPresenceKind; detail?: string }[] = [
  { kind: 'reading', detail: 'comments' },
  { kind: 'reading', detail: 'github_pr' },
  { kind: 'thinking' },
  { kind: 'tool', detail: 'create_work_product(brief)' },
  { kind: 'writing', detail: 'draft v1' },
  { kind: 'thinking' },
  { kind: 'idle' },
]

export function useDemoAgentPresence({
  enabled = true,
  intervalMs = 2400,
}: {
  enabled?: boolean
  intervalMs?: number
} = {}) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % DEMO_CYCLE.length)
    }, intervalMs)
    return () => clearInterval(id)
  }, [enabled, intervalMs])

  return DEMO_CYCLE[index] ?? { kind: 'idle' as const }
}
