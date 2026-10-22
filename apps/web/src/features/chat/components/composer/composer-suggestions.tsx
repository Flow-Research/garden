/**
 * ComposerSuggestions — "Jump right in" pills row shown above the composer.
 *
 * Replaces the old `EMPTY_STATE_TILES` / `EmptyStateTile` from
 * `chat-panel-controller.tsx` (2026-09-08 spec §10). A row of 7 dismissible
 * suggestion pills, purely presentational — the parent (chat-panel-controller,
 * Task 13) owns whether it is shown and manages dismissed state. Pills only
 * prefill the composer draft; no business logic here.
 *
 * Consulted: `composer-tools.ts` for SUGGESTION_PILLS structure,
 * `chat-panel-controller.tsx` for motion patterns, UI button components from
 * `@garden/ui/components/ui/button`.
 */

import type { ReactElement } from 'react'
import { X } from 'lucide-react'
import { Button } from '@garden/ui/components/ui/button'
import { cn } from '@garden/ui/lib/utils'
import { COMPOSER_WIDTH_CLASS_NAME } from './composer-helpers'
import { SUGGESTION_PILLS } from './composer-tools'

/**
 * Easing constant shared with the composer's lift animation.
 * Exported so Task 13 (chat-panel-controller) can import it instead of
 * duplicating — avoids circular imports (controller imports from ./composer)
 * and keeps the pill fade in sync with the composer's appearance.
 */
export const EMPTY_INTRO_EASE = [0.32, 0.72, 0, 1] as const

export interface ComposerSuggestionsProps {
  /**
   * Called when a pill is clicked, passed the pill's starter text.
   * Parent uses this to prefill the composer draft.
   */
  onSelect: (starter: string) => void

  /**
   * Called when the dismiss button is clicked.
   * Parent owns the dismissed state and visibility logic.
   */
  onDismiss: () => void
}

/**
 * Renders the "Jump right in" suggestion pills row.
 * Purely presentational; parent controls visibility and dismissed state.
 */
export function ComposerSuggestions({
  onSelect,
  onDismiss,
}: ComposerSuggestionsProps): ReactElement {
  return (
    <div className={cn('mx-auto w-full', COMPOSER_WIDTH_CLASS_NAME)}>
      {/* Header row */}
      <div className="mb-2 flex items-center justify-between">
        <span className="body-small text-text-secondary">Jump right in</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Dismiss suggestions"
          onClick={onDismiss}
          className="text-icon-secondary"
        >
          <X className="size-4" />
        </Button>
      </div>

      {/* Pills */}
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-2">
        {SUGGESTION_PILLS.map((pill) => (
          <button
            key={pill.id}
            type="button"
            aria-label={pill.label}
            onClick={() => onSelect(pill.starter)}
            className="inline-flex items-center gap-3 whitespace-nowrap rounded-pill border border-border-default px-4 py-2 transition-colors hover:bg-background-main-secondary"
          >
            <pill.icon className="size-[18px] text-icon-secondary" />
            <span className="body-small text-text-secondary">{pill.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
