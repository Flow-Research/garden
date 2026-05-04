'use client'

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import type { ActiveRunStatus } from '../components/active-run-panel'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RunLifecycleToastInput {
  /** Stable run id; transitions are tracked per-run. */
  runId: string
  /** Current run status. Hook fires on transitions, not first observation. */
  status: ActiveRunStatus
  /** Issue identifier for the toast subtitle (e.g. "ACC-43"). */
  issueIdentifier: string | null
  /** Title of the issue (truncated in the toast). */
  issueTitle: string | null
  /** Agent display name (for "Bot has a question on ACC-43"). */
  agentName: string
  /**
   * True iff the user is currently looking at this issue's detail page.
   * When true, suppress toasts — the in-page state is enough.
   */
  isViewingIssue: boolean
  /**
   * Called when the user clicks the toast's primary action — usually a
   * deep-link nav into the issue with a focus anchor.
   */
  onNavigate?: (issueIdentifier: string, focusKey: string) => void
}

// ─── Hook ────────────────────────────────────────────────────────────────────
//
// Subscribes to `status` transitions on a single run. Fires a toast when
// the new state warrants attention. The user can be on a different page
// (board, inbox, chat, settings) and still get pinged.
//
// Suppression rules:
//   - First observation of a run never fires a toast (no transition known yet).
//   - `isViewingIssue === true` suppresses everything (in-page state is enough).
//   - `queued` and `cancelled` transitions are silent (uninteresting alone).
//
// One toast per transition. Toast IDs are derived from the (runId, toStatus)
// pair so a re-render with the same status doesn't double-fire.

export function useRunLifecycleToasts({
  runId,
  status,
  issueIdentifier,
  issueTitle,
  agentName,
  isViewingIssue,
  onNavigate,
}: RunLifecycleToastInput) {
  const previousStatusRef = useRef<ActiveRunStatus | null>(null)

  useEffect(() => {
    const previous = previousStatusRef.current

    // First observation — record and exit. No toast on initial mount.
    if (previous === null) {
      previousStatusRef.current = status
      return
    }

    // No transition.
    if (previous === status) return

    // Now we have a real transition. Decide whether to toast.
    previousStatusRef.current = status

    if (isViewingIssue) return
    if (!issueIdentifier) return

    const subject = issueTitle
      ? `${issueIdentifier} · ${truncate(issueTitle, 60)}`
      : issueIdentifier

    const navigate = (focusKey: string) =>
      onNavigate?.(issueIdentifier, focusKey)

    const toastId = `run:${runId}:${status}`

    switch (status) {
      case 'waiting_for_input':
        toast.warning(`${agentName} has a question`, {
          id: toastId,
          description: subject,
          action: {
            label: 'Reply',
            onClick: () => navigate(`question:${runId}`),
          },
          duration: 12_000,
        })
        return

      case 'waiting_for_approval':
        toast.warning(`${agentName} wants your approval`, {
          id: toastId,
          description: subject,
          action: {
            label: 'Review',
            onClick: () => navigate(`approval:${runId}`),
          },
          duration: 12_000,
        })
        return

      case 'blocked':
        toast.error(`${agentName} is blocked`, {
          id: toastId,
          description: subject,
          action: {
            label: 'Open',
            onClick: () => navigate(`blocked:${runId}`),
          },
          duration: 10_000,
        })
        return

      case 'failed':
        // Less urgent than blocked — failed runs are usually retryable
        // by the reconciler. Surface quietly.
        toast(`${agentName} hit an error`, {
          id: toastId,
          description: subject,
          action: {
            label: 'Open',
            onClick: () => navigate(`failed_run:${runId}`),
          },
          duration: 8_000,
        })
        return

      case 'succeeded':
        toast.success(`${agentName} finished`, {
          id: toastId,
          description: subject,
          action: {
            label: 'View',
            onClick: () => navigate(`succeeded:${runId}`),
          },
          duration: 6_000,
        })
        return

      // Silent transitions: queued (uninteresting on its own), running
      // (transitive), cancelled (user-initiated, they know).
      case 'queued':
      case 'running':
      case 'cancelled':
        return
    }
  }, [
    runId,
    status,
    issueIdentifier,
    issueTitle,
    agentName,
    isViewingIssue,
    onNavigate,
  ])
}

// ─── Demo trigger (used in /dev/issue-flow showcase) ─────────────────────────

/** Fire one toast of each lifecycle kind, sequenced ~1s apart. */
export function fireLifecycleToastDemo({
  agentName = 'Garden',
  issueIdentifier = 'ACC-43',
  issueTitle = 'Add OAuth callback for GitHub',
  onNavigate,
}: {
  agentName?: string
  issueIdentifier?: string
  issueTitle?: string
  onNavigate?: (issueIdentifier: string, focusKey: string) => void
} = {}) {
  const subject = `${issueIdentifier} · ${issueTitle}`
  const sequence: Array<() => void> = [
    () =>
      toast.warning(`${agentName} has a question`, {
        description: subject,
        action: {
          label: 'Reply',
          onClick: () => onNavigate?.(issueIdentifier, 'question:demo'),
        },
      }),
    () =>
      toast.warning(`${agentName} wants your approval`, {
        description: subject,
        action: {
          label: 'Review',
          onClick: () => onNavigate?.(issueIdentifier, 'approval:demo'),
        },
      }),
    () =>
      toast.error(`${agentName} is blocked`, {
        description: subject,
        action: {
          label: 'Open',
          onClick: () => onNavigate?.(issueIdentifier, 'blocked:demo'),
        },
      }),
    () =>
      toast(`${agentName} hit an error`, {
        description: subject,
        action: {
          label: 'Open',
          onClick: () => onNavigate?.(issueIdentifier, 'failed_run:demo'),
        },
      }),
    () =>
      toast.success(`${agentName} finished`, {
        description: subject,
        action: {
          label: 'View',
          onClick: () => onNavigate?.(issueIdentifier, 'succeeded:demo'),
        },
      }),
  ]
  sequence.forEach((fn, i) => setTimeout(fn, i * 900))
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}
