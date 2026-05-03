'use client'

import { Button } from '@garden/ui/components/ui/button'
import { cn } from '@garden/ui/lib/utils'
import { LegendList, type LegendListRef } from '@legendapp/list/react'
import type { UIMessage } from 'ai'
import { ChevronDownIcon, DownloadIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

type ConversationRow<TItem = ReactNode> =
  | {
      key: string
      kind: 'node'
      node: ReactNode
    }
  | {
      item: TItem
      key: string
      kind: 'data'
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

export type ConversationProps<TItem = ReactNode> = ComponentProps<'div'> & {
  data?: readonly TItem[]
  estimateItemSize?: number
  getItemKey?: (item: TItem, index: number) => string
  renderItem?: (args: { index: number; item: TItem }) => ReactNode
}

export function Conversation<TItem = ReactNode>({
  children,
  className,
  data,
  estimateItemSize = 140,
  getItemKey,
  renderItem: renderDataItem,
  ...props
}: ConversationProps<TItem>) {
  const listRef = useRef<LegendListRef | null>(null)
  const previousRowCountRef = useRef(0)
  const [isAtBottom, setIsAtBottom] = useState(true)

  const updateStickiness = useCallback(() => {
    const state = listRef.current?.getState?.()
    if (state) setIsAtBottom(state.isAtEnd)
  }, [])

  const scrollToBottom = useCallback(() => {
    listRef.current?.scrollToEnd?.({ animated: true })
    setIsAtBottom(true)
  }, [])

  const { rows: rawRows, overlayItems } = useMemo<{
    overlayItems: ReactNode[]
    rows: ConversationRow<TItem>[]
  }>(() => {
    if (data && renderDataItem && getItemKey) {
      return {
        overlayItems: Children.toArray(children),
        rows: data.map((item, index) => ({
          item,
          key: getItemKey(item, index),
          kind: 'data',
        })),
      }
    }

    const allChildren = Children.toArray(children)
    const content: ReactNode[] = []
    const overlay: ReactNode[] = []

    allChildren.forEach((child) => {
      if (isValidElement<ConversationContentProps>(child)) {
        if (child.type === ConversationContent) {
          content.push(...Children.toArray(child.props.children))
          return
        }
      }
      overlay.push(child)
    })

    const listRows = content.map((node, index) => ({
      key:
        isValidElement(node) && node.key != null
          ? String(node.key)
          : `conversation-row-${index}`,
      kind: 'node' as const,
      node,
    }))

    return { rows: listRows, overlayItems: overlay }
  }, [children, data, getItemKey, renderDataItem])
  const rows = useStableConversationRows(rawRows)

  const renderItem = useCallback(
    ({ index, item }: { index: number; item: ConversationRow<TItem> }) => (
      <div
        className={cn(
          'mx-auto w-full max-w-2xl px-4',
          index === 0 ? 'pt-4 pb-4' : 'pb-4',
        )}
      >
        {item.kind === 'data' && renderDataItem
          ? renderDataItem({ index, item: item.item })
          : item.kind === 'node'
            ? item.node
            : null}
      </div>
    ),
    [renderDataItem],
  )

  useEffect(() => {
    const previousRowCount = previousRowCountRef.current
    previousRowCountRef.current = rows.length

    if (previousRowCount > 0 || rows.length === 0) return

    setIsAtBottom(true)
    const frameId = window.requestAnimationFrame(() => {
      listRef.current?.scrollToEnd?.({ animated: false })
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [rows.length])

  return (
    <ConversationContext.Provider
      value={{ isAtBottom, scrollToBottom }}
    >
      <div
        role="log"
        {...props}
        className={cn('relative min-h-0 flex-1 overflow-hidden', className)}
      >
        <LegendList<ConversationRow<TItem>>
          ref={listRef}
          data={rows}
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          estimatedItemSize={estimateItemSize}
          alignItemsAtEnd
          initialScrollAtEnd
          maintainScrollAtEnd
          maintainScrollAtEndThreshold={0.1}
          maintainVisibleContentPosition
          onScroll={updateStickiness}
          className="h-full overflow-x-hidden overscroll-y-contain"
        />
        {overlayItems}
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
  if (left.kind !== right.kind || left.key !== right.key) return false
  if (left.kind === 'data' && right.kind === 'data') {
    return left.item === right.item
  }
  if (left.kind === 'node' && right.kind === 'node') {
    return left.node === right.node
  }
  return false
}

export type ConversationContentProps = ComponentProps<'div'>

export const ConversationContent = ({
  className,
  ...props
}: ConversationContentProps) => (
  <div {...props} className={cn('flex flex-col gap-8 p-4', className)} />
)

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
