'use client'

import { Button } from '@garden/ui/components/ui/button'
import { cn } from '@garden/ui/lib/utils'
import { LegendList, type LegendListRef } from '@legendapp/list/react'
import type { UIMessage } from 'ai'
import { ChevronDownIcon, DownloadIcon } from 'lucide-react'
import type {
  ComponentProps,
  ReactNode,
  TouchEvent as ReactTouchEvent,
  WheelEvent as ReactWheelEvent,
} from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'

const DEFAULT_ESTIMATED_LIST_SIZE = { height: 640, width: 720 }

type ConversationRow<TItem> = {
  item: TItem
  key: string
}

type ConversationContextValue = {
  isAtBottom: boolean
  scrollToBottom: () => void
}

const ConversationContext = createContext<ConversationContextValue | null>(null)

function useConversationContext() {
  const context = useContext(ConversationContext)
  if (!context) {
    throw new Error('Conversation components must be used within Conversation')
  }
  return context
}

export type ConversationProps<TItem> = ComponentProps<'div'> & {
  data: readonly TItem[]
  drawDistance?: number
  estimatedListSize?: { height: number; width: number }
  estimateItemSize?: number
  getItemKey: (item: TItem, index: number) => string
  initialContainerPoolRatio?: number
  initialScrollKey?: string
  renderItem: (args: { index: number; item: TItem }) => ReactNode
}

export function Conversation<TItem>({
  children,
  className,
  data,
  drawDistance,
  estimatedListSize = DEFAULT_ESTIMATED_LIST_SIZE,
  estimateItemSize = 90,
  getItemKey,
  initialContainerPoolRatio,
  initialScrollKey,
  onTouchStart,
  onWheel,
  renderItem: renderDataItem,
  ...props
}: ConversationProps<TItem>) {
  const listRef = useRef<LegendListRef | null>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)

  const updateStickiness = useCallback(() => {
    const state = listRef.current?.getState?.()
    if (state) setIsAtBottom(state.isAtEnd)
  }, [])

  const scrollToBottom = useCallback(() => {
    listRef.current?.scrollToEnd?.({ animated: true })
    setIsAtBottom(true)
  }, [])

  const rawRows = useMemo(
    () =>
      data.map((item, index) => ({
        item,
        key: getItemKey(item, index),
      })),
    [data, getItemKey],
  )
  const rows = useStableConversationRows(rawRows)

  const renderItem = useCallback(
    ({ index, item }: { index: number; item: ConversationRow<TItem> }) => (
      <div
        className={cn(
          'mx-auto w-full max-w-2xl px-4',
          index === 0 ? 'pt-4 pb-4' : 'pb-4',
        )}
      >
        {renderDataItem({ index, item: item.item })}
      </div>
    ),
    [renderDataItem],
  )

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      onWheel?.(event)
    },
    [onWheel],
  )

  const handleTouchStart = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>) => {
      onTouchStart?.(event)
    },
    [onTouchStart],
  )

  const listBootKey = `${initialScrollKey ?? 'conversation'}:${
    rows.length > 0 ? 'ready' : 'empty'
  }`

  return (
    <ConversationContext.Provider value={{ isAtBottom, scrollToBottom }}>
      <div
        role="log"
        {...props}
        onTouchStart={handleTouchStart}
        onWheel={handleWheel}
        className={cn('relative min-h-0 flex-1 overflow-hidden', className)}
      >
        <LegendList<ConversationRow<TItem>>
          key={listBootKey}
          ref={listRef}
          data={rows}
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          drawDistance={drawDistance}
          estimatedListSize={estimatedListSize}
          estimatedItemSize={estimateItemSize}
          initialContainerPoolRatio={initialContainerPoolRatio}
          initialScrollAtEnd
          maintainScrollAtEnd
          maintainScrollAtEndThreshold={0.1}
          maintainVisibleContentPosition
          onScroll={updateStickiness}
          className="h-full overflow-x-hidden overscroll-y-contain"
        />
        {children}
      </div>
    </ConversationContext.Provider>
  )
}

function useStableConversationRows<TItem>(
  rows: ConversationRow<TItem>[],
): ConversationRow<TItem>[] {
  const previousRowsRef = useRef<{
    byKey: Map<string, ConversationRow<TItem>>
    result: ConversationRow<TItem>[]
  }>({
    byKey: new Map(),
    result: [],
  })

  return useMemo(() => {
    const previous = previousRowsRef.current
    const byKey = new Map<string, ConversationRow<TItem>>()
    let changed = rows.length !== previous.result.length

    const result = rows.map((row, index) => {
      const previousRow = previous.byKey.get(row.key)
      const nextRow =
        previousRow && conversationRowsEqual(previousRow, row)
          ? previousRow
          : row
      byKey.set(row.key, nextRow)
      if (!changed && previous.result[index] !== nextRow) changed = true
      return nextRow
    })

    const next = changed ? { byKey, result } : previous
    previousRowsRef.current = next
    return next.result
  }, [rows])
}

function conversationRowsEqual<TItem>(
  left: ConversationRow<TItem>,
  right: ConversationRow<TItem>,
) {
  return left.key === right.key && left.item === right.item
}

export type ConversationEmptyStateProps = ComponentProps<'div'> & {
  title?: string
  description?: string
  icon?: React.ReactNode
}

export const ConversationEmptyState = ({
  className,
  title = 'No messages yet',
  description = 'Start a conversation to see messages here',
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      'flex size-full flex-col items-center justify-center gap-3 p-8 text-center',
      className,
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div className="space-y-1">
          <h3 className="font-medium text-sm">{title}</h3>
          {description && (
            <p className="text-muted-foreground text-sm">{description}</p>
          )}
        </div>
      </>
    )}
  </div>
)

export type ConversationScrollButtonProps = ComponentProps<typeof Button>

export const ConversationScrollButton = ({
  children,
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useConversationContext()

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom()
  }, [scrollToBottom])

  return (
    !isAtBottom && (
      <Button
        className={cn(
          'absolute bottom-4 left-[50%] z-10 h-7 translate-x-[-50%] gap-1.5 rounded-full border-border/60 bg-card px-3 text-muted-foreground text-xs shadow-sm hover:border-border hover:text-foreground dark:bg-background dark:hover:bg-muted',
          className,
        )}
        onClick={handleScrollToBottom}
        size="sm"
        type="button"
        variant="outline"
        {...props}
      >
        {children ?? (
          <>
            <ChevronDownIcon className="size-3.5" />
            Scroll to bottom
          </>
        )}
      </Button>
    )
  )
}

const getMessageText = (message: UIMessage): string =>
  message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')

export type ConversationDownloadProps = Omit<
  ComponentProps<typeof Button>,
  'onClick'
> & {
  messages: UIMessage[]
  filename?: string
  formatMessage?: (message: UIMessage, index: number) => string
}

const defaultFormatMessage = (message: UIMessage): string => {
  const roleLabel = message.role.charAt(0).toUpperCase() + message.role.slice(1)
  return `**${roleLabel}:** ${getMessageText(message)}`
}

export const messagesToMarkdown = (
  messages: UIMessage[],
  formatMessage: (
    message: UIMessage,
    index: number,
  ) => string = defaultFormatMessage,
): string => messages.map((msg, i) => formatMessage(msg, i)).join('\n\n')

export const ConversationDownload = ({
  messages,
  filename = 'conversation.md',
  formatMessage = defaultFormatMessage,
  className,
  children,
  ...props
}: ConversationDownloadProps) => {
  const handleDownload = useCallback(() => {
    const markdown = messagesToMarkdown(messages, formatMessage)
    const blob = new Blob([markdown], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link as unknown as Node)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }, [messages, filename, formatMessage])

  return (
    <Button
      className={cn(
        'absolute top-4 right-4 rounded-full dark:bg-background dark:hover:bg-muted',
        className,
      )}
      onClick={handleDownload}
      size="icon"
      type="button"
      variant="outline"
      {...props}
    >
      {children ?? <DownloadIcon className="size-4" />}
    </Button>
  )
}
