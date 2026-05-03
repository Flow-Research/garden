'use client'

import { Button } from '@garden/ui/components/ui/button'
import { cn } from '@garden/ui/lib/utils'
import { LegendList, type LegendListRef } from '@legendapp/list/react'
import type { UIMessage } from 'ai'
import { ChevronDownIcon, DownloadIcon } from 'lucide-react'
import type { ComponentProps, ReactElement, ReactNode } from 'react'
import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'

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

export type ConversationProps = ComponentProps<'div'>

export const Conversation = ({
  children,
  className,
  ...props
}: ConversationProps) => {
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

  const { contentItems, overlayItems } = useMemo(() => {
    const allChildren = Children.toArray(children)
    const content: ReactElement<ConversationContentProps>[] = []
    const overlay: ReactNode[] = []

    allChildren.forEach((child) => {
      if (isValidElement<ConversationContentProps>(child)) {
        if (child.type === ConversationContent) {
          content.push(child)
          return
        }
      }
      overlay.push(child)
    })

    return { contentItems: content, overlayItems: overlay }
  }, [children])

  const renderItem = useCallback(
    ({ item }: { item: ReactElement<ConversationContentProps> }) => item,
    [],
  )

  return (
    <ConversationContext.Provider
      value={{ isAtBottom, scrollToBottom }}
    >
      <div
        role="log"
        {...props}
        className={cn('relative min-h-0 flex-1 overflow-hidden', className)}
      >
        <LegendList<ReactElement<ConversationContentProps>>
          ref={listRef}
          data={contentItems}
          keyExtractor={(_, index) => `conversation-content-${index}`}
          renderItem={renderItem}
          estimatedItemSize={520}
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
