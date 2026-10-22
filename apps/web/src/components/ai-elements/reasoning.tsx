import { useControllableState } from '@radix-ui/react-use-controllable-state'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@garden/ui/components/ui/collapsible'
import { cn } from '@garden/ui/lib/utils'
import { cjk } from '@streamdown/cjk'
import { code } from '@streamdown/code'
import { math } from '@streamdown/math'
import { mermaid } from '@streamdown/mermaid'
import { ChevronDownIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Streamdown } from 'streamdown'

import { Shimmer } from './shimmer'

interface ReasoningContextValue {
  isStreaming: boolean
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  duration: number | undefined
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null)

export const useReasoning = () => {
  const context = useContext(ReasoningContext)
  if (!context) {
    throw new Error('Reasoning components must be used within Reasoning')
  }
  return context
}

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  duration?: number
}

const AUTO_CLOSE_DELAY = 1000
const MS_IN_S = 1000

export const Reasoning = memo(
  ({
    className,
    isStreaming = false,
    open,
    defaultOpen,
    onOpenChange,
    duration: durationProp,
    children,
    ...props
  }: ReasoningProps) => {
    const resolvedDefaultOpen = defaultOpen ?? isStreaming
    // Track if defaultOpen was explicitly set to false (to prevent auto-open)
    const isExplicitlyClosed = defaultOpen === false

    const [isOpen, setIsOpen] = useControllableState<boolean>({
      defaultProp: resolvedDefaultOpen,
      onChange: onOpenChange,
      prop: open,
    })
    const [duration, setDuration] = useControllableState<number | undefined>({
      defaultProp: undefined,
      prop: durationProp,
    })

    const hasEverStreamedRef = useRef(isStreaming)
    const [hasAutoClosed, setHasAutoClosed] = useState(false)
    const startTimeRef = useRef<number | null>(null)

    // Track when streaming starts and compute duration
    useEffect(() => {
      if (isStreaming) {
        hasEverStreamedRef.current = true
        if (startTimeRef.current === null) {
          startTimeRef.current = Date.now()
        }
      } else if (startTimeRef.current !== null) {
        setDuration(Math.ceil((Date.now() - startTimeRef.current) / MS_IN_S))
        startTimeRef.current = null
      }
    }, [isStreaming, setDuration])

    // Auto-open when streaming starts (unless explicitly closed)
    useEffect(() => {
      if (isStreaming && !isOpen && !isExplicitlyClosed) {
        setIsOpen(true)
      }
    }, [isStreaming, isOpen, setIsOpen, isExplicitlyClosed])

    // Auto-close when streaming ends (once only, and only if it ever streamed)
    useEffect(() => {
      if (
        !hasEverStreamedRef.current ||
        isStreaming ||
        !isOpen ||
        hasAutoClosed
      ) {
        return
      }
      const timer = setTimeout(() => {
        setIsOpen(false)
        setHasAutoClosed(true)
      }, AUTO_CLOSE_DELAY)

      return () => clearTimeout(timer)
    }, [isStreaming, isOpen, setIsOpen, hasAutoClosed])

    const handleOpenChange = useCallback(
      (newOpen: boolean) => {
        setIsOpen(newOpen)
      },
      [setIsOpen],
    )

    const contextValue = useMemo(
      () => ({ duration, isOpen, isStreaming, setIsOpen }),
      [duration, isOpen, isStreaming, setIsOpen],
    )

    return (
      <ReasoningContext.Provider value={contextValue}>
        <Collapsible
          className={cn('not-prose', className)}
          onOpenChange={handleOpenChange}
          open={isOpen}
          {...props}
        >
          {children}
        </Collapsible>
      </ReasoningContext.Provider>
    )
  },
)

export type ReasoningTriggerProps = ComponentProps<
  typeof CollapsibleTrigger
> & {
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode
}

const SECONDS_IN_MINUTE = 60

/**
 * Reasoning turns routinely run for minutes, and the old copy rendered that as
 * "Thought for 154 seconds" — a number the reader has to divide in their head.
 * Anything at or over a minute is now reported in minutes, matching the design's
 * "Thought for 2mins".
 */
function formatThinkingDuration(seconds: number) {
  if (seconds < SECONDS_IN_MINUTE) {
    return `${seconds} second${seconds === 1 ? '' : 's'}`
  }
  const minutes = Math.round(seconds / SECONDS_IN_MINUTE)
  return `${minutes} min${minutes === 1 ? '' : 's'}`
}

const defaultGetThinkingMessage = (isStreaming: boolean, duration?: number) => {
  if (isStreaming || duration === 0) {
    return <Shimmer duration={1}>Thinking...</Shimmer>
  }
  if (duration === undefined) {
    return <p>Thought for a few seconds</p>
  }
  return <p>Thought for {formatThinkingDuration(duration)}</p>
}

export const ReasoningTrigger = memo(
  ({
    className,
    children,
    getThinkingMessage = defaultGetThinkingMessage,
    ...props
  }: ReasoningTriggerProps) => {
    const { isStreaming, isOpen, duration } = useReasoning()

    return (
      <CollapsibleTrigger
        className={cn(
          'flex w-full items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground',
          className,
        )}
        {...props}
      >
        {children ?? (
          <>
            {getThinkingMessage(isStreaming, duration)}
            <ChevronDownIcon
              className={cn(
                'size-4 shrink-0 transition-transform',
                isOpen ? 'rotate-180' : 'rotate-0',
              )}
            />
          </>
        )}
      </CollapsibleTrigger>
    )
  },
)

export type ReasoningContentProps = ComponentProps<
  typeof CollapsibleContent
> & {
  children: string
}

const streamdownPlugins = { cjk, code, math, mermaid }

/**
 * One branch of the reasoning tree, rendered in place of every paragraph in
 * the summary.
 *
 * Before: `ReasoningContent` split the text on newlines and gave each line its
 * own `<Streamdown>`. A 40-line summary meant 40 markdown pipelines, each with
 * the cjk/code/math/mermaid plugins attached, and all of them re-rendered on
 * every streamed token because the split re-ran whenever `children` changed.
 *
 * After: a single `<Streamdown>` parses the whole summary and this component
 * is handed to it as the `p` renderer, so the branches come out of the one
 * parse. Streamdown splits its input into blocks and memoizes them, so a
 * streamed token only re-parses the tail block — and streamdown 2.6.0
 * (vercel/streamdown#584) is what makes that memoization trustworthy when a
 * block is rewritten to the same length, which is exactly the shape a rewritten
 * reasoning beat has.
 *
 * The connector is two absolutely positioned spans rather than an SVG so it
 * inherits `--border` and stays crisp at any zoom: the first draws the elbow
 * (trunk from the row's top down to its vertical centre, then a rounded turn
 * into the text), the second continues the trunk from that centre to the row's
 * bottom so consecutive rows join up. The continuation is hidden on the last
 * row so the trunk terminates at the final elbow instead of trailing into
 * nothing — `last:` works here because Streamdown renders each block's element
 * directly into the content container, making these real siblings.
 */
function ReasoningBeat({ children }: ComponentProps<'p'>) {
  return (
    <div className="group/reasoning-beat relative py-1.5 pl-10">
      <span
        aria-hidden
        className="pointer-events-none absolute left-6 top-0 h-[calc(50%+0.5px)] w-3 rounded-bl-lg border-b border-l border-border"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-6 top-1/2 w-px bg-border group-last/reasoning-beat:hidden"
      />
      {children}
    </div>
  )
}

const reasoningComponents = { p: ReasoningBeat }

export const ReasoningContent = memo(
  ({ className, children, ...props }: ReasoningContentProps) => (
    <CollapsibleContent
      className={cn(
        'mt-1 text-sm',
        'data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-muted-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in',
        className,
      )}
      {...props}
    >
      <Streamdown components={reasoningComponents} plugins={streamdownPlugins}>
        {children}
      </Streamdown>
    </CollapsibleContent>
  ),
)

Reasoning.displayName = 'Reasoning'
ReasoningTrigger.displayName = 'ReasoningTrigger'
ReasoningContent.displayName = 'ReasoningContent'
