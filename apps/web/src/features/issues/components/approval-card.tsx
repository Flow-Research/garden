import { useEffect, useState } from 'react'
import { cn } from '@garden/ui/lib/utils'
import { Button } from '@garden/ui/components/ui/button'

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Discriminated by `kind` so future approval types (agent_proposal,
 * billing_authorisation, …) can extend the card with custom body renderers
 * without forking the component.
 *
 * Today's kinds:
 *   - 'connector_write' — agent wants to send_external / destructive
 *     against a connector. Body is a markdown preview of what gets sent.
 *   - 'agent_proposal' — Garden wants to spawn a new agent. Body shows the
 *     proposed config (name, role, voice, optional skills + source issue).
 *
 * Adding a new kind: extend the union, pass a `body` ReactNode tailored to
 * the new payload, optionally an `onEditApprove` handler.
 */
export type ApprovalKind = 'connector_write' | 'agent_proposal' | (string & {})

export interface ApprovalCardProps {
  kind: ApprovalKind
  /** Headline — "Garden wants to comment on github.com/acme/web#142" / "Garden proposes a new Researcher agent" */
  title: string
  /**
   * Optional secondary line — "→ #eng-deploys" / "for issue ACC-43".
   * Smaller and muted; gives the user one extra anchor of context.
   */
  targetLabel?: string | null
  /**
   * Body content. Caller renders the markdown / structured payload / form.
   * Free-form so future kinds (json-render forms, rich previews) can plug in
   * without changing this component.
   */
  body: React.ReactNode
  /** Pulse the card border on mount — for inbox deep-link arrivals. */
  pulseOnMount?: boolean
  /** Approve the proposal as-is. */
  onApprove: () => void
  /** Deny / cancel. */
  onDeny: () => void
  /** Open an edit dialog before approving. Optional — omit to hide the button. */
  onEditApprove?: () => void
  /** Disabled while a previous click is still resolving. */
  pending?: boolean
  /** Override the primary button label (default "Approve"). */
  approveLabel?: string
  /** Override the deny button label (default "Deny"). */
  denyLabel?: string
  /**
   * When the card is rendered standalone (e.g. inbox detail panel) instead
   * of inline inside the active-run panel, give it its own border/padding.
   * Default false: assumes a parent container provides border + padding.
   */
  standalone?: boolean
}

// ─── Card ────────────────────────────────────────────────────────────────────

export function ApprovalCard({
  kind: _kind,
  title,
  targetLabel,
  body,
  pulseOnMount = false,
  onApprove,
  onDeny,
  onEditApprove,
  pending = false,
  approveLabel = 'Approve',
  denyLabel = 'Deny',
  standalone = false,
}: ApprovalCardProps) {
  const [isPulsing, setIsPulsing] = useState(pulseOnMount)

  useEffect(() => {
    if (!pulseOnMount) return
    const id = setTimeout(() => setIsPulsing(false), 1400)
    return () => clearTimeout(id)
  }, [pulseOnMount])

  return (
    <div
      data-approval-kind={_kind}
      className={cn(
        'space-y-2 transition-shadow',
        standalone &&
          'rounded-lg border border-warning/30 bg-warning/[0.04] px-3.5 py-3',
        !standalone && 'border-t border-warning/15 px-3 py-2.5',
        isPulsing && 'shadow-[0_0_0_3px_rgb(245_158_11/0.18)]',
      )}
    >
      <div className="text-xs font-medium text-foreground">{title}</div>
      {targetLabel && (
        <div className="text-[11px] text-muted-foreground">→ {targetLabel}</div>
      )}
      <div className="text-xs text-muted-foreground">{body}</div>
      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          className="h-7"
          onClick={onApprove}
          disabled={pending}
        >
          {approveLabel}
        </Button>
        {onEditApprove && (
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            onClick={onEditApprove}
            disabled={pending}
          >
            Edit &amp; approve
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-muted-foreground"
          onClick={onDeny}
          disabled={pending}
        >
          {denyLabel}
        </Button>
      </div>
    </div>
  )
}

// ─── Convenience wrapper for connector-write previews ────────────────────────
//
// Default body shape: a 3-line clamp of markdown text. Most callers want this;
// callers needing richer rendering pass their own `body` to ApprovalCard
// directly.

export function ConnectorWriteBody({ text }: { text: string }) {
  return <div className="line-clamp-3">{text}</div>
}

// ─── Convenience wrapper for agent-proposal previews ─────────────────────────
//
// MVP version — static name / role / voice text. The rich version (json-render
// editable form) is in known-gaps; that one replaces this body without
// changing the surrounding card.

export interface AgentProposalBodyProps {
  name: string
  role: string
  description?: string | null
  skills?: string[]
  source_issue_identifier?: string | null
}

export function AgentProposalBody({
  name,
  role,
  description,
  skills,
  source_issue_identifier,
}: AgentProposalBodyProps) {
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[80px_1fr] gap-x-2 gap-y-0.5 text-[11px]">
        <span className="font-mono text-muted-foreground/70">Name</span>
        <span className="text-foreground">{name}</span>
        <span className="font-mono text-muted-foreground/70">Role</span>
        <span className="text-foreground">{role}</span>
        {description && (
          <>
            <span className="font-mono text-muted-foreground/70">Voice</span>
            <span className="text-foreground/85 leading-relaxed">
              {description}
            </span>
          </>
        )}
        {skills && skills.length > 0 && (
          <>
            <span className="font-mono text-muted-foreground/70">Skills</span>
            <span className="text-foreground/85">{skills.join(', ')}</span>
          </>
        )}
        {source_issue_identifier && (
          <>
            <span className="font-mono text-muted-foreground/70">For</span>
            <span className="text-foreground/85">
              {source_issue_identifier}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
