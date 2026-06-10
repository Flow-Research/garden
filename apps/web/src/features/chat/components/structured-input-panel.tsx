import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import {
  type StructuredQuestion,
  type StructuredQuestionDraft,
  type StructuredQuestionAnswers,
  type StructuredQuestionOption,
  resolveQuestionAnswer,
  toggleOptionSelection,
  buildAnswers,
  findFirstUnanswered,
} from '@garden/app-state/chat'
import { cn } from '@garden/ui/lib/utils'

// ── Panel ────────────────────────────────────────────────────────────────────

type StructuredInputPanelProps = {
  questions: StructuredQuestion[]
  onSubmit: (answers: StructuredQuestionAnswers) => void
  disabled?: boolean
}

export const StructuredInputPanel = memo(function StructuredInputPanel({
  questions,
  onSubmit,
  disabled = false,
}: StructuredInputPanelProps) {
  const [drafts, setDrafts] = useState<
    Record<string, StructuredQuestionDraft>
  >({})
  const [questionIndex, setQuestionIndex] = useState(() =>
    findFirstUnanswered(questions, {}),
  )
  const autoAdvanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onSubmitRef = useRef(onSubmit)

  useEffect(() => {
    onSubmitRef.current = onSubmit
  }, [onSubmit])

  useEffect(() => {
    return () => {
      if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current)
    }
  }, [])

  const activeQuestion = questions[questionIndex] ?? null
  const isLast = questionIndex >= questions.length - 1
  const allAnswered = buildAnswers(questions, drafts)
  const selectedLabels = drafts[activeQuestion?.id ?? '']?.selectedLabels ?? []

  const handleToggle = useCallback(
    (optionLabel: string) => {
      if (!activeQuestion || disabled) return

      setDrafts((prev) => {
        const next = {
          ...prev,
          [activeQuestion.id]: toggleOptionSelection(
            activeQuestion,
            prev[activeQuestion.id],
            optionLabel,
          ),
        }

        // Auto-advance for single-select after a short delay
        if (!activeQuestion.multiSelect) {
          if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current)
          autoAdvanceTimer.current = setTimeout(() => {
            autoAdvanceTimer.current = null
            setQuestionIndex((idx: number) => {
              if (idx >= questions.length - 1) return idx
              return idx + 1
            })

            // Check if all answered and auto-submit
            const resolved = buildAnswers(questions, next)
            if (resolved) onSubmitRef.current(resolved)
          }, 200)
        }

        return next
      })
    },
    [activeQuestion, disabled, questions],
  )

  const handleAdvance = useCallback(() => {
    if (isLast && allAnswered) {
      onSubmitRef.current(allAnswered)
      return
    }
    setQuestionIndex((idx) => Math.min(idx + 1, questions.length - 1))
  }, [isLast, allAnswered, questions.length])

  // Keyboard shortcuts: number keys 1-9 select options
  useEffect(() => {
    if (!activeQuestion || disabled) return
    const handler = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      )
        return
      if (
        target instanceof HTMLElement &&
        target.closest('[contenteditable]:not([contenteditable="false"])')
      )
        return

      const digit = Number.parseInt(event.key, 10)
      if (Number.isNaN(digit) || digit < 1 || digit > 9) return
      if (digit > activeQuestion.options.length) return
      const option: StructuredQuestionOption | undefined =
        activeQuestion.options[digit - 1]
      if (!option) return
      event.preventDefault()
      handleToggle(option.label)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [activeQuestion, disabled, handleToggle])

  if (!activeQuestion) return null

  const resolved = resolveQuestionAnswer(
    activeQuestion,
    drafts[activeQuestion.id],
  )

  return (
    <div className="px-4 py-3 sm:px-5">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          {questions.length > 1 ? (
            <span className="flex h-5 items-center rounded-md bg-muted/60 px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground/60">
              {questionIndex + 1}/{questions.length}
            </span>
          ) : null}
          {activeQuestion.header ? (
            <span className="text-[11px] font-semibold tracking-widest text-muted-foreground/50 uppercase">
              {activeQuestion.header}
            </span>
          ) : null}
        </div>
      </div>
      <p className="mt-1.5 text-sm text-foreground/90">
        {activeQuestion.question}
      </p>
      {activeQuestion.multiSelect ? (
        <p className="mt-1 text-xs text-muted-foreground/65">
          Select one or more options.
        </p>
      ) : null}
      <div className="mt-3 space-y-1">
        {activeQuestion.options.map(
          (option: StructuredQuestionOption, index: number) => {
            const isSelected = selectedLabels.includes(option.label)
            const shortcutKey = index < 9 ? index + 1 : null
            return (
              <button
                key={`${activeQuestion.id}:${option.label}`}
                type="button"
                disabled={disabled}
                onClick={() => handleToggle(option.label)}
                className={cn(
                  'group flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-all duration-150',
                  isSelected
                    ? 'border-blue-500/40 bg-blue-500/8 text-foreground'
                    : 'border-transparent bg-muted/20 text-foreground/80 hover:bg-muted/40 hover:border-border/40',
                  disabled && 'opacity-50 cursor-not-allowed',
                )}
              >
                {shortcutKey !== null ? (
                  <kbd
                    className={cn(
                      'flex size-5 shrink-0 items-center justify-center rounded text-[11px] font-medium tabular-nums transition-colors duration-150',
                      isSelected
                        ? 'bg-blue-500/20 text-blue-400'
                        : 'bg-muted/40 text-muted-foreground/50 group-hover:bg-muted/60 group-hover:text-muted-foreground/70',
                    )}
                  >
                    {shortcutKey}
                  </kbd>
                ) : null}
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium">{option.label}</span>
                  {option.description && option.description !== option.label ? (
                    <span className="ml-2 text-xs text-muted-foreground/50">
                      {option.description}
                    </span>
                  ) : null}
                </div>
                {isSelected ? (
                  <Check className="size-3.5 shrink-0 text-blue-400" />
                ) : null}
              </button>
            )
          },
        )}
      </div>

      {/* Multi-select confirm */}
      {activeQuestion.multiSelect && resolved ? (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            disabled={disabled}
            onClick={handleAdvance}
            className={cn(
              'rounded-md bg-blue-500/90 px-3 py-1.5 text-xs font-medium text-white',
              'hover:bg-blue-500 transition-colors',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500/50',
            )}
          >
            {isLast ? 'Submit' : 'Next'}
          </button>
        </div>
      ) : null}
    </div>
  )
})
