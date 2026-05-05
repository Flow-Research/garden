'use client'

import { useEffect, useState } from 'react'
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Loader2,
  ShieldCheck,
  Square,
  XCircle,
} from 'lucide-react'
import type { StructuredQuestion } from '@garden/core/chat'
import { cn } from '@garden/ui/lib/utils'
import { Alert, AlertDescription } from '@garden/ui/components/ui/alert'
import { Button } from '@garden/ui/components/ui/button'
import { AgentPresence, type AgentPresenceKind } from './agent-presence'
import { ApprovalCard, ConnectorWriteBody } from './approval-card'
import { LiveDot } from './live-dot'
import { QuestionCard } from './question-card'

// ─── Types ───────────────────────────────────────────────────────────────────

export type ActiveRunStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_input'
  | 'waiting_for_approval'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'blocked'

export interface ActiveRunPanelProps {
  agent: { name: string; icon?: string | null }
  run: {
    id: string
    status: ActiveRunStatus
    started_at: string | null
    finished_at: string | null
    error: string | null
    error_detail?: string | null
    usage: {
      total_tokens: number
      model: string
      step_count?: number
    } | null
  }
  /** The latest event's compact summary (e.g. `→ read_source(github_pr)`). */
  lastEventSummary?: string | null
  /**
   * When `waiting_for_input`, the question to render. Either:
   *   - a `StructuredQuestion` (preferred — agent's `ask_question` payload, may
   *     have options for chip rendering), or
   *   - a plain string (legacy / pure free-text question).
   * The Question card renders chips when options exist and always renders a
   * free-text fallback input below.
   */
  pendingQuestion?: StructuredQuestion | string | null
  /** When `waiting_for_approval`, a preview of what Bot wants to do. */
  pendingApprovalPreview?: {
    title: string
    body: string
    targetLabel?: string
  } | null
  /** Pulse the question/approval card on mount — for inbox deep-link arrivals. */
  pulseFocus?: boolean
  /**
   * Lightweight presence cue between turn boundaries — "Bot is thinking",
   * "Bot is reading source", etc. Surfaces under the header row when set.
   * Real-time WS feed is deferred (Assumption 10); for MVP the server-side
   * polling derives this from the latest `issue_run_event` payload. The dev
   * showcase wires `useDemoAgentPresence` for animation without a backend.
   */
  presence?: {
    kind: AgentPresenceKind
    detail?: string | null
    label?: string
  } | null
  onStop?: () => void
  onApprove?: () => void
  onDeny?: () => void
  onEditApprove?: () => void
  /** Submit the answer to a `waiting_for_input` question. Receives chosen
   * option label(s) or the typed custom answer. */
  onAnswerQuestion?: (answer: string | string[]) => void
  /** True while the answer is being submitted. */
  answering?: boolean
  /** When in debug mode, the panel renders expanded by default and shows extra metadata. */
  debugMode?: boolean
  /** Cost in USD cents. Computed by the caller from usage + pricing table. */
  estimatedCostCents?: number
}

/** Coerce the incoming pendingQuestion (string | StructuredQuestion) into a
 * StructuredQuestion shape so the panel only has one render path. */
function asStructuredQuestion(
  input: StructuredQuestion | string | null | undefined,
  runId: string,
): StructuredQuestion | null {
  if (!input) return null
  if (typeof input === 'string') {
    return { id: `q_legacy_${runId}`, question: input, options: [] }
  }
  return input
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function elapsed(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const remSec = sec % 60
  return `${min}m ${remSec}s`
}

function formatTokens(n: number): string {
  if (n < 1_000) return `${n}`
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function formatRunDuration(
  startedAt: string | null,
  finishedAt: string | null,
): string | null {
  if (!startedAt) return null
  const startedMs = new Date(startedAt).getTime()
  const finishedMs = finishedAt ? new Date(finishedAt).getTime() : Date.now()
  if (Number.isNaN(startedMs) || Number.isNaN(finishedMs)) return null
  const seconds = Math.max(0, Math.round((finishedMs - startedMs) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remSeconds = seconds % 60
  return `${minutes}m ${remSeconds}s`
}

function buildDebugErrorDetail({
  run,
  lastEventSummary,
  tokens,
  cost,
}: {
  run: ActiveRunPanelProps['run']
  lastEventSummary?: string | null
  tokens: string | null
  cost: string | null
}): string {
  const detail = run.error_detail?.trim()
  const duration = formatRunDuration(run.started_at, run.finished_at)
  const lines = [
    detail,
    `run_id: ${run.id}`,
    `status: ${run.status}`,
    `started_at: ${run.started_at ?? 'null'}`,
    `finished_at: ${run.finished_at ?? 'null'}`,
    duration ? `duration: ${duration}` : null,
    run.error ? `error: ${run.error}` : 'error: null',
    lastEventSummary ? `last_event: ${lastEventSummary}` : null,
    run.usage?.step_count != null
      ? `step_count: ${run.usage.step_count}`
      : null,
    tokens ? `tokens: ${tokens}` : null,
    cost ? `estimated_cost: ${cost}` : null,
    run.usage?.model ? `model: ${run.usage.model}` : null,
  ]
  return lines.filter((line): line is string => Boolean(line)).join('\n')
}

// ─── Stop confirmation strip ─────────────────────────────────────────────────

function StopConfirm({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>Stop? Bot exits on the next turn.</span>
      <Button
        size="sm"
        variant="destructive"
        className="h-6 px-2"
        onClick={onConfirm}
      >
        Stop
      </Button>
      <Button size="sm" variant="ghost" className="h-6 px-2" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}

// ─── State configurations ───────────────────────────────────────────────────

type StateConfig = {
  containerClass: string
  iconNode: React.ReactNode
  headline: string
  liveVariant: React.ComponentProps<typeof LiveDot>['variant']
}

function getStateConfig(
  status: ActiveRunStatus,
  agentName: string,
): StateConfig {
  switch (status) {
    case 'queued':
      return {
        containerClass: 'border-info/20 bg-info/5',
        iconNode: <Loader2 className="h-3.5 w-3.5 animate-spin text-info" />,
        headline: `${agentName} is starting…`,
        liveVariant: 'queued',
      }
    case 'running':
      return {
        containerClass: 'border-info/20 bg-info/5',
        iconNode: <Loader2 className="h-3.5 w-3.5 animate-spin text-info" />,
        headline: `${agentName} is working`,
        liveVariant: 'running',
      }
    case 'waiting_for_input':
      return {
        containerClass: 'border-warning/30 bg-warning/5',
        iconNode: <CircleHelp className="h-3.5 w-3.5 text-warning" />,
        headline: `${agentName} is waiting on you`,
        liveVariant: 'waiting',
      }
    case 'waiting_for_approval':
      return {
        containerClass: 'border-warning/30 bg-warning/5',
        iconNode: <ShieldCheck className="h-3.5 w-3.5 text-warning" />,
        headline: `${agentName} wants your approval`,
        liveVariant: 'waiting',
      }
    case 'succeeded':
      return {
        containerClass: 'border-success/20 bg-success/5',
        iconNode: <Check className="h-3.5 w-3.5 text-success" />,
        headline: `${agentName} finished`,
        liveVariant: 'succeeded',
      }
    case 'failed':
      return {
        containerClass: 'border-destructive/30 bg-destructive/5',
        iconNode: <XCircle className="h-3.5 w-3.5 text-destructive" />,
        headline: `${agentName} hit an error`,
        liveVariant: 'failed',
      }
    case 'cancelled':
      return {
        containerClass: 'border-border bg-muted/30',
        iconNode: <Square className="h-3.5 w-3.5 text-muted-foreground" />,
        headline: `${agentName} was stopped`,
        liveVariant: 'failed',
      }
    case 'blocked':
      return {
        containerClass: 'border-destructive/30 bg-destructive/5',
        iconNode: <AlertCircle className="h-3.5 w-3.5 text-destructive" />,
        headline: `${agentName} is blocked`,
        liveVariant: 'blocked',
      }
  }
}

// ─── Main panel ──────────────────────────────────────────────────────────────

export function ActiveRunPanel(props: ActiveRunPanelProps) {
  const {
    agent,
    run,
    lastEventSummary,
    pendingQuestion,
    pendingApprovalPreview,
    pulseFocus = false,
    presence,
    onStop,
    onApprove,
    onDeny,
    onEditApprove,
    onAnswerQuestion,
    answering = false,
    debugMode = false,
    estimatedCostCents,
  } = props
  const structuredQuestion = asStructuredQuestion(pendingQuestion, run.id)

  const hasBody = Boolean(
    (run.status === 'waiting_for_input' && structuredQuestion) ||
    (run.status === 'waiting_for_approval' && pendingApprovalPreview) ||
    (run.status === 'blocked' && run.error) ||
    run.status === 'failed',
  )
  const [open, setOpen] = useState(hasBody || debugMode)
  const [showStopConfirm, setShowStopConfirm] = useState(false)
  const [elapsedLabel, setElapsedLabel] = useState('')

  const isLive = run.status === 'queued' || run.status === 'running'
  const isWaiting =
    run.status === 'waiting_for_input' || run.status === 'waiting_for_approval'

  // Tick elapsed label every second while live or waiting.
  useEffect(() => {
    if (!run.started_at) return
    setElapsedLabel(elapsed(run.started_at))
    if (!isLive && !isWaiting) return
    const id = setInterval(
      () => setElapsedLabel(elapsed(run.started_at!)),
      1000,
    )
    return () => clearInterval(id)
  }, [run.started_at, isLive, isWaiting])

  const config = getStateConfig(run.status, agent.name)
  const cost = estimatedCostCents != null ? formatUsd(estimatedCostCents) : null
  const tokens = run.usage ? formatTokens(run.usage.total_tokens) : null
  const debugErrorDetail = buildDebugErrorDetail({
    run,
    lastEventSummary,
    tokens,
    cost,
  })

  return (
    <div
      data-status={run.status}
      className={cn(
        'rounded-lg border backdrop-blur-sm transition-colors',
        config.containerClass,
      )}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <LiveDot variant={config.liveVariant} className="ml-0.5 mr-1" />
        {config.iconNode}
        <span className="text-xs font-medium text-foreground truncate">
          {config.headline}
        </span>
        {(isLive || isWaiting) && elapsedLabel && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {elapsedLabel}
          </span>
        )}
        {/* lastEventSummary is engineering metadata (e.g. "→ create_work_product(brief)").
            Hidden by default per the plan's "quiet floor" — debug mode reveals it. */}
        {isLive && lastEventSummary && debugMode && (
          <span className="ml-2 truncate text-xs text-muted-foreground/80 font-mono">
            {lastEventSummary}
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          {isLive && !showStopConfirm && onStop && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
              onClick={() => setShowStopConfirm(true)}
            >
              <Square className="h-3 w-3 mr-1" />
              Stop
            </Button>
          )}
          {isLive && showStopConfirm && (
            <StopConfirm
              onConfirm={() => {
                setShowStopConfirm(false)
                onStop?.()
              }}
              onCancel={() => setShowStopConfirm(false)}
            />
          )}
          {(hasBody || debugMode) && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-muted-foreground"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={open ? 'Collapse details' : 'Expand details'}
            >
              {open ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Body — collapsible */}
      {open && (
        <>
          {/* Presence cue — only while running */}
          {isLive && presence && presence.kind !== 'idle' && (
            <div className="border-t border-info/15 bg-info/[0.015] px-3 py-1.5">
              <AgentPresence
                kind={presence.kind}
                agentName={agent.name}
                label={presence.label}
                detail={presence.detail ?? undefined}
                compact
              />
            </div>
          )}

          {run.status === 'waiting_for_input' && structuredQuestion && (
            <QuestionCard
              question={structuredQuestion}
              agentName={agent.name}
              onSubmit={(answer) => onAnswerQuestion?.(answer)}
              submitting={answering}
              pulseOnMount={pulseFocus}
              compact
            />
          )}

          {run.status === 'waiting_for_approval' && pendingApprovalPreview && (
            <ApprovalCard
              kind="connector_write"
              title={pendingApprovalPreview.title}
              targetLabel={pendingApprovalPreview.targetLabel}
              body={<ConnectorWriteBody text={pendingApprovalPreview.body} />}
              pulseOnMount={pulseFocus}
              onApprove={() => onApprove?.()}
              onDeny={() => onDeny?.()}
              onEditApprove={onEditApprove ? () => onEditApprove() : undefined}
            />
          )}

          {run.status === 'blocked' && run.error && (
            <Alert
              variant="destructive"
              className="rounded-none border-0 border-t border-destructive/15 bg-transparent px-3 py-2.5"
            >
              <AlertCircle />
              <AlertDescription className="text-xs leading-relaxed text-foreground/90">
                {run.error}
              </AlertDescription>
            </Alert>
          )}

          {run.status === 'failed' && (
            <Alert
              variant="destructive"
              className="rounded-none border-0 border-t border-destructive/15 bg-transparent px-3 py-2.5"
            >
              <XCircle />
              <AlertDescription className="space-y-2">
                <div className="break-words font-mono text-xs leading-relaxed">
                  {run.error ?? 'Run failed without an error message.'}
                </div>
                {debugMode && (
                  <div className="rounded-md border border-destructive/20 bg-background/60 p-2">
                    <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-destructive/80">
                      Debug error
                    </div>
                    <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
                      {debugErrorDetail}
                    </pre>
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}
        </>
      )}

      {/* Footer row: debug-only runtime metadata. */}
      {debugMode && (tokens || cost) && (
        <div className="flex items-center gap-2 border-t border-border/40 px-3 py-1.5 text-[11px] text-muted-foreground">
          {tokens && <span className="tabular-nums">{tokens} tokens</span>}
          {cost && <span className="tabular-nums">· {cost}</span>}
          {run.usage?.model && <span>· {run.usage.model}</span>}
          <span className="ml-auto font-mono text-[10px]">
            run:{run.id.slice(-6)} · status:{run.status}
          </span>
        </div>
      )}

      {/* Expanded debug content */}
      {open && debugMode && (
        <div className="border-t border-border/40 px-3 py-2 text-[11px] text-muted-foreground space-y-1">
          <div>started_at: {run.started_at ?? '—'}</div>
          <div>finished_at: {run.finished_at ?? '—'}</div>
          {run.usage && (
            <>
              <div>step_count: {run.usage.step_count ?? 'unknown'}</div>
              <div>total: {run.usage.total_tokens.toLocaleString()} tokens</div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Empty state ─────────────────────────────────────────────────────────────

export function ActiveRunPanelEmpty() {
  return (
    <div className="rounded-lg border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground">
      No agent assigned. Assign an agent to start a run.
    </div>
  )
}

// ─── Last-run summary line (when no active run, but past runs exist) ────────

export function LastRunSummary({
  lastRun,
  debugMode = false,
}: {
  lastRun: {
    status: ActiveRunStatus
    finished_at: string | null
    usage: { total_tokens: number; model: string } | null
  }
  estimatedCostCents?: number
  debugMode?: boolean
}) {
  if (!lastRun.finished_at) return null
  const finishedSec = Math.floor(
    (Date.now() - new Date(lastRun.finished_at).getTime()) / 1000,
  )
  const ago =
    finishedSec < 60
      ? `${finishedSec}s ago`
      : finishedSec < 3600
        ? `${Math.floor(finishedSec / 60)}m ago`
        : `${Math.floor(finishedSec / 3600)}h ago`
  return (
    <div className="text-xs text-muted-foreground">
      Last run:{' '}
      <span className="font-medium text-foreground/80">{lastRun.status}</span> ·{' '}
      {ago}
      {debugMode && lastRun.usage && (
        <>
          {' '}
          · {formatTokens(lastRun.usage.total_tokens)} tokens ·{' '}
          {lastRun.usage.model}
        </>
      )}
    </div>
  )
}
