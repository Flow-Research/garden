import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, MessageCircleQuestion } from 'lucide-react'
import {
  type StructuredQuestion,
  type StructuredQuestionDraft,
  resolveQuestionAnswer,
  toggleOptionSelection,
} from '@garden/app-state/chat'
import { cn } from '@garden/ui/lib/utils'
import { Button } from '@garden/ui/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@garden/ui/components/ui/empty'
import { Kbd } from '@garden/ui/components/ui/kbd'
import { Textarea } from '@garden/ui/components/ui/textarea'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface QuestionCardProps {
  /** The structured question payload from the agent's `ask_question` tool. */
  question: StructuredQuestion
  /**
   * Called when the user submits an answer. Receives either the chosen option
   * label(s) or the free-text custom answer (custom always wins when non-empty,
   * matching `resolveQuestionAnswer`).
   */
  onSubmit: (answer: string | string[]) => void
  /** When true, Bot is processing the answer; chips/input go disabled. */
  submitting?: boolean
  /** Compact mode renders without the chrome header (used inside the panel). */
  compact?: boolean
  /** Pulse the border on mount — for inbox deep-link arrivals. */
  pulseOnMount?: boolean
  /** Bot agent's display name + icon (defaults to "Bot"). */
  agentName?: string
}

// ─── Card ────────────────────────────────────────────────────────────────────
//
// One Question card per `waiting_for_input` run. Renders two affordances and
// always both:
//
//   1. Option chips (when `question.options.length > 0`)
//      - Single-select: clicking submits immediately.
//      - Multi-select: clicking toggles, Submit appears at the bottom.
//      - Number keys 1–9 select corresponding option.
//
//   2. Free-text input (always rendered)
//      - "Or write your own answer…" — the escape hatch.
//      - Cmd+Enter submits the typed text as the custom answer.
//      - Custom text wins over selected chips when both exist.
//
// Visually warning-tinted (matches the active-run panel's
// waiting state) but distinct from the approval card by using a softer fill
// and a question-mark icon rather than a shield.

export function QuestionCard({
  question,
  onSubmit,
  submitting = false,
  compact = false,
  pulseOnMount = false,
  agentName = 'the agent',
}: QuestionCardProps) {
  const [draft, setDraft] = useState<StructuredQuestionDraft>({})
  const [isPulsing, setIsPulsing] = useState(pulseOnMount)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  // Focus the free-text input on mount when this is a deep-link arrival,
  // since "from inbox" implies the user wants to answer immediately.
  useEffect(() => {
    if (pulseOnMount && inputRef.current) {
      inputRef.current.focus()
    }
    if (pulseOnMount) {
      const id = setTimeout(() => setIsPulsing(false), 1400)
      return () => clearTimeout(id)
    }
  }, [pulseOnMount])

  const hasOptions = question.options.length > 0
  const selected = draft.selectedLabels ?? []
  const customAnswer = draft.customAnswer ?? ''

  const handleToggle = useCallback(
    (label: string) => {
      if (submitting) return
      const next = toggleOptionSelection(question, draft, label)
      setDraft(next)

      // Single-select chips auto-submit immediately. The 200ms tick from the
      // chat panel feels like a deliberate pause; on a static issue page we
      // want it instant so the answer lands and Bot resumes.
      if (!question.multiSelect) {
        const answer = resolveQuestionAnswer(question, next)
        if (answer) onSubmit(answer)
      }
    },
    [question, draft, submitting, onSubmit],
  )

  const handleSubmit = useCallback(() => {
    if (submitting) return
    const answer = resolveQuestionAnswer(question, draft)
    if (answer === null) return
    onSubmit(answer)
  }, [question, draft, submitting, onSubmit])

  const handleCustomChange = useCallback((value: string) => {
    setDraft((prev) => ({ ...prev, customAnswer: value }))
  }, [])

  // Cmd+Enter / Ctrl+Enter submits the custom answer.
  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit],
  )

  // Number-key shortcuts (1–9) select chips when no input is focused.
  useEffect(() => {
    if (!hasOptions || submitting) return
    const handler = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      )
        return
      const digit = Number.parseInt(event.key, 10)
      if (Number.isNaN(digit) || digit < 1 || digit > 9) return
      const option = question.options[digit - 1]
      if (!option) return
      event.preventDefault()
      handleToggle(option.label)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [hasOptions, question.options, submitting, handleToggle])

  const canSubmit =
    customAnswer.trim().length > 0 ||
    (question.multiSelect && selected.length > 0)

  return (
    <div
      data-question-id={question.id}
      className={cn(
        !compact && 'rounded-lg border border-warning/30 bg-warning/[0.04]',
        isPulsing && 'shadow-[0_0_0_3px_rgb(245_158_11/0.18)]',
        compact ? '' : 'overflow-hidden',
      )}
    >
      {/* Header — hidden in compact mode (panel already provides context) */}
      {!compact && (
        <div className="flex items-start gap-2.5 px-3.5 pt-3 pb-2">
          <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-warning/80">
                {question.header ?? 'Question'}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {agentName} is waiting on you
              </span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-foreground/90">
              {question.question}
            </p>
            {question.multiSelect && hasOptions && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Pick any that apply, or write your own answer below.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Compact mode: question text only, no chrome */}
      {compact && (
        <div className="px-3 pt-1.5 pb-1">
          <p className="text-sm leading-snug text-foreground/90">
            {question.question}
          </p>
          {question.multiSelect && hasOptions && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Pick any that apply, or write your own answer below.
            </p>
          )}
        </div>
      )}

      {/* Chips */}
      {hasOptions && (
        <div
          className={cn('space-y-1', compact ? 'px-3 pb-1.5' : 'px-3.5 pb-2')}
        >
          {question.options.map((option, index) => {
            const isSelected = selected.includes(option.label)
            const shortcutKey = index < 9 ? index + 1 : null
            return (
              <button
                key={`${question.id}:${option.label}`}
                type="button"
                disabled={submitting}
                onClick={() => handleToggle(option.label)}
                className={cn(
                  'group relative flex w-full items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-all',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-warning/50',
                  isSelected
                    ? 'border-warning/50 bg-warning/[0.08] text-foreground'
                    : 'border-border/40 bg-background/40 text-foreground/85 hover:border-warning/30 hover:bg-warning/[0.04]',
                  submitting && 'opacity-50 cursor-not-allowed',
                )}
              >
                {shortcutKey !== null && (
                  <Kbd
                    className={cn(
                      'mt-0.5 size-4 min-w-4 rounded text-[10px] tabular-nums transition-colors',
                      isSelected &&
                        'bg-warning/25 text-warning group-hover:bg-warning/25',
                    )}
                  >
                    {shortcutKey}
                  </Kbd>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium leading-snug">
                    {option.label}
                  </div>
                  {option.description &&
                    option.description !== option.label && (
                      <div className="mt-0.5 text-[11px] text-muted-foreground/85 leading-snug">
                        {option.description}
                      </div>
                    )}
                </div>
                {isSelected && (
                  <Check className="mt-0.5 size-3.5 shrink-0 text-warning" />
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Free-text fallback — always rendered. The escape hatch. */}
      <div
        className={cn(
          'border-t border-warning/15',
          compact ? 'px-3 py-2' : 'px-3.5 py-2.5',
          hasOptions ? 'bg-background/20' : '',
        )}
      >
        <div className="relative flex items-end gap-2">
          <Textarea
            ref={inputRef}
            value={customAnswer}
            onChange={(e) => handleCustomChange(e.target.value)}
            onKeyDown={handleInputKeyDown}
            disabled={submitting}
            placeholder={
              hasOptions
                ? 'Or write your own answer…'
                : `Reply to ${agentName}…`
            }
            rows={1}
            className="min-h-9 max-h-32 flex-1 resize-none px-2.5 py-2 text-sm focus-visible:border-warning/50 focus-visible:ring-warning/30 md:text-sm"
          />
          <Button
            size="sm"
            disabled={!canSubmit || submitting}
            onClick={handleSubmit}
            className="h-9 shrink-0 gap-1 px-2.5"
          >
            <ArrowUp className="h-3.5 w-3.5" />
            <span className="text-xs">
              {question.multiSelect && selected.length > 0 && !customAnswer
                ? `Submit ${selected.length}`
                : 'Send'}
            </span>
          </Button>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground/70">
          {hasOptions ? (
            <span>
              Tip: number keys pick options.{' '}
              <Kbd className="h-3.5 text-[9px]">⌘</Kbd>
              <Kbd className="h-3.5 text-[9px]">↵</Kbd> sends typed answer.
            </span>
          ) : (
            <span>
              Tip: <Kbd className="h-3.5 text-[9px]">⌘</Kbd>
              <Kbd className="h-3.5 text-[9px]">↵</Kbd> to send.
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Empty / placeholder ────────────────────────────────────────────────────

export function QuestionCardEmpty() {
  return (
    <Empty className="border px-3.5 py-3">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MessageCircleQuestion />
        </EmptyMedia>
        <EmptyTitle>No pending question</EmptyTitle>
        <EmptyDescription>
          Bot will surface its next question here.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
