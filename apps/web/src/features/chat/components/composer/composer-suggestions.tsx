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

const SUGGESTION_ROWS = Array.from(
  { length: Math.ceil(SUGGESTION_PILLS.length / 3) },
  (_, index) => SUGGESTION_PILLS.slice(index * 3, index * 3 + 3),
)

/**
 * Renders the "Jump right in" suggestion pills row.
 * Purely presentational; parent controls visibility and dismissed state.
 */
export function ComposerSuggestions({
  onSelect,
  onDismiss,
}: ComposerSuggestionsProps): JSX.Element {
  return (
    <div className={cn('mx-auto w-full', COMPOSER_WIDTH_CLASS_NAME)}>
      <div className="mx-3 md:mx-10">
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
        <div className="space-y-1.5 sm:flex sm:flex-wrap sm:justify-center sm:gap-x-3 sm:gap-y-2 sm:space-y-0">
          {SUGGESTION_ROWS.map((row, rowIndex) => (
            <div
              key={`suggestion-row-${rowIndex}`}
              className="overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:contents"
            >
              <div className="flex min-w-max gap-1.5 sm:contents">
                {row.map((pill) => (
                  <button
                    key={pill.id}
                    type="button"
                    aria-label={pill.label}
                    onClick={() => onSelect(pill.starter)}
                    className="inline-flex shrink-0 items-center justify-start gap-2 rounded-pill border border-border-default px-2.5 py-1.5 transition-colors hover:bg-background-main-secondary sm:w-auto sm:justify-center sm:gap-3 sm:px-4 sm:py-2"
                  >
                    <pill.icon className="size-4 shrink-0 text-icon-secondary sm:size-[18px]" />
                    <span className="min-w-0 text-left body-small leading-tight text-text-secondary sm:text-center">
                      {pill.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
