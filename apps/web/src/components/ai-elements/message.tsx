import { Button } from '@garden/ui/components/ui/button'
import {
  ButtonGroup,
  ButtonGroupText,
} from '@garden/ui/components/ui/button-group'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@garden/ui/components/ui/tooltip'
import { cn } from '@garden/ui/lib/utils'
import { cjk } from '@streamdown/cjk'
import { code } from '@streamdown/code'
import { math } from '@streamdown/math'
import { mermaid } from '@streamdown/mermaid'
import type { UIMessage } from 'ai'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import type { ComponentProps, HTMLAttributes, ReactElement } from 'react'
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { Streamdown, defaultRehypePlugins } from 'streamdown'
import { IssueMentionCard } from '@/features/issues/components/issue-mention-card'

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage['role']
}

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      'group flex w-full max-w-[90%] flex-col gap-2',
      from === 'user' ? 'is-user ml-auto justify-end' : 'is-assistant',
      className,
    )}
    {...props}
  />
)

export type MessageContentProps = HTMLAttributes<HTMLDivElement>

/**
 * Why the two roles diverge so much: the design gives each role a bubble, but
 * they wrap different things.
 *
 * Before: one shared shell painted the user bubble (grey `secondary` with a
 * `rounded-br-sm` tail) and left the assistant transparent, so assistant text
 * had no surface of its own and attachments sat *inside* the user bubble.
 *
 * After: for a user message the content block IS the bubble — brand green with
 * `primary-foreground` text, uniform 16px radius, and attachments lifted out to
 * sit above it as a sibling of `Message` (see `MessageFiles` in chat-timeline).
 * For an assistant message this stays a transparent full-width column: its
 * reasoning row, tool activity, artifacts and citations must all sit *outside*
 * any bubble, so only the prose gets one — drawn per text part by
 * `MessageBubble`.
 */
export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      'flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm leading-relaxed text-foreground',
      'group-[.is-user]:ml-auto group-[.is-user]:rounded-2xl group-[.is-user]:bg-primary group-[.is-user]:px-4 group-[.is-user]:py-2 group-[.is-user]:text-primary-foreground',
      'group-[.is-assistant]:w-full',
      className,
    )}
    {...props}
  >
    {children}
  </div>
)

export type MessageBubbleProps = HTMLAttributes<HTMLDivElement>

/**
 * The assistant's prose surface: a `muted` pill that hugs its text.
 *
 * Exists because an assistant message is not one block — it interleaves a
 * reasoning row, tool activity, artifact cards and prose, and only the prose is
 * meant to sit on a filled surface. Painting `MessageContent` instead would put
 * a grey rectangle behind full-width artifact and approval cards.
 *
 * It is deliberately inert inside a user message (`group-[.is-assistant]:`
 * scoping only): there the surrounding `MessageContent` is already the bubble,
 * so a second one would nest grey inside green.
 */
export const MessageBubble = ({
  children,
  className,
  ...props
}: MessageBubbleProps) => (
  <div
    className={cn(
      'min-w-0 max-w-full',
      'group-[.is-assistant]:w-fit group-[.is-assistant]:rounded-2xl group-[.is-assistant]:bg-muted group-[.is-assistant]:px-4 group-[.is-assistant]:py-2',
      className,
    )}
    {...props}
  >
    {children}
  </div>
)

export type MessageActionsProps = ComponentProps<'div'>

export const MessageActions = ({
  className,
  children,
  ...props
}: MessageActionsProps) => (
  <div className={cn('flex items-center gap-1', className)} {...props}>
    {children}
  </div>
)

export type MessageActionProps = ComponentProps<typeof Button> & {
  tooltip?: string
  label?: string
}

export const MessageAction = ({
  tooltip,
  children,
  label,
  variant = 'ghost',
  size = 'icon-sm',
  ...props
}: MessageActionProps) => {
  const button = (
    <Button size={size} type="button" variant={variant} {...props}>
      {children}
      <span className="sr-only">{label || tooltip}</span>
    </Button>
  )

  if (tooltip) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>{button}</TooltipTrigger>
          <TooltipContent>
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return button
}

interface MessageBranchContextType {
  currentBranch: number
  totalBranches: number
  goToPrevious: () => void
  goToNext: () => void
  branches: ReactElement[]
  setBranches: (branches: ReactElement[]) => void
}

const MessageBranchContext = createContext<MessageBranchContextType | null>(
  null,
)

const useMessageBranch = () => {
  const context = useContext(MessageBranchContext)

  if (!context) {
    throw new Error(
      'MessageBranch components must be used within MessageBranch',
    )
  }

  return context
}

export type MessageBranchProps = HTMLAttributes<HTMLDivElement> & {
  defaultBranch?: number
  onBranchChange?: (branchIndex: number) => void
}

export const MessageBranch = ({
  defaultBranch = 0,
  onBranchChange,
  className,
  ...props
}: MessageBranchProps) => {
  const [currentBranch, setCurrentBranch] = useState(defaultBranch)
  const [branches, setBranches] = useState<ReactElement[]>([])

  const handleBranchChange = useCallback(
    (newBranch: number) => {
      setCurrentBranch(newBranch)
      onBranchChange?.(newBranch)
    },
    [onBranchChange],
  )

  const goToPrevious = useCallback(() => {
    const newBranch =
      currentBranch > 0 ? currentBranch - 1 : branches.length - 1
    handleBranchChange(newBranch)
  }, [currentBranch, branches.length, handleBranchChange])

  const goToNext = useCallback(() => {
    const newBranch =
      currentBranch < branches.length - 1 ? currentBranch + 1 : 0
    handleBranchChange(newBranch)
  }, [currentBranch, branches.length, handleBranchChange])

  const contextValue = useMemo<MessageBranchContextType>(
    () => ({
      branches,
      currentBranch,
      goToNext,
      goToPrevious,
      setBranches,
      totalBranches: branches.length,
    }),
    [branches, currentBranch, goToNext, goToPrevious],
  )

  return (
    <MessageBranchContext.Provider value={contextValue}>
      <div
        className={cn('grid w-full gap-2 [&>div]:pb-0', className)}
        {...props}
      />
    </MessageBranchContext.Provider>
  )
}

export type MessageBranchContentProps = HTMLAttributes<HTMLDivElement>

export const MessageBranchContent = ({
  children,
  ...props
}: MessageBranchContentProps) => {
  const { currentBranch, setBranches, branches } = useMessageBranch()
  const childrenArray = useMemo(
    () => (Array.isArray(children) ? children : [children]),
    [children],
  )

  // Use useEffect to update branches when they change
  useEffect(() => {
    if (branches.length !== childrenArray.length) {
      setBranches(childrenArray)
    }
  }, [childrenArray, branches, setBranches])

  return childrenArray.map((branch, index) => (
    <div
      className={cn(
        'grid gap-2 overflow-hidden [&>div]:pb-0',
        index === currentBranch ? 'block' : 'hidden',
      )}
      key={branch.key}
      {...props}
    >
      {branch}
    </div>
  ))
}

export type MessageBranchSelectorProps = ComponentProps<typeof ButtonGroup>

export const MessageBranchSelector = ({
  className,
  ...props
}: MessageBranchSelectorProps) => {
  const { totalBranches } = useMessageBranch()

  // Don't render if there's only one branch
  if (totalBranches <= 1) {
    return null
  }

  return (
    <ButtonGroup
      className={cn(
        '[&>*:not(:first-child)]:rounded-l-md [&>*:not(:last-child)]:rounded-r-md',
        className,
      )}
      orientation="horizontal"
      {...props}
    />
  )
}

export type MessageBranchPreviousProps = ComponentProps<typeof Button>

export const MessageBranchPrevious = ({
  children,
  ...props
}: MessageBranchPreviousProps) => {
  const { goToPrevious, totalBranches } = useMessageBranch()

  return (
    <Button
      aria-label="Previous branch"
      disabled={totalBranches <= 1}
      onClick={goToPrevious}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronLeftIcon size={14} />}
    </Button>
  )
}

export type MessageBranchNextProps = ComponentProps<typeof Button>

export const MessageBranchNext = ({
  children,
  ...props
}: MessageBranchNextProps) => {
  const { goToNext, totalBranches } = useMessageBranch()

  return (
    <Button
      aria-label="Next branch"
      disabled={totalBranches <= 1}
      onClick={goToNext}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronRightIcon size={14} />}
    </Button>
  )
}

export type MessageBranchPageProps = HTMLAttributes<HTMLSpanElement>

export const MessageBranchPage = ({
  className,
  ...props
}: MessageBranchPageProps) => {
  const { currentBranch, totalBranches } = useMessageBranch()

  return (
    <ButtonGroupText
      className={cn(
        'border-none bg-transparent text-muted-foreground shadow-none',
        className,
      )}
      {...props}
    >
      {currentBranch + 1} of {totalBranches}
    </ButtonGroupText>
  )
}

export type MessageResponseProps = ComponentProps<typeof Streamdown>

const streamdownPlugins = { cjk, code, math, mermaid }

/**
 * Why this exists: agents emit issue/agent references as `mention://<type>/<id>`
 * markdown links (see packages/agent-runtime instructions). Streamdown's default
 * `rehype-sanitize` schema only whitelists standard href protocols (http(s),
 * mailto, plus `tel`), so the `mention://` href was stripped during sanitization.
 *
 * Observed before: by the time `MentionAwareAnchor` ran, `href` was `undefined`
 * — the regex never matched, so issue references rendered as inert plain `<a>`
 * tags (no chip, not clickable, "undefined" url). The non-chat renderer
 * (packages/ui/markdown/Markdown.tsx) already allows `mention` in its schema;
 * the chat path on Streamdown never did.
 *
 * Fix: reuse Streamdown's own default plugin pipeline (raw → sanitize → harden,
 * exported as `defaultRehypePlugins`) and extend only the sanitize schema's
 * allowed href protocols with `mention`. Reusing the bundled plugins keeps the
 * `tel` href + code `metastring` allowances Streamdown adds for shiki, and
 * avoids a version-skewed standalone `rehype-sanitize` import.
 */
const [sanitizePlugin, sanitizeSchema] = defaultRehypePlugins.sanitize as [
  unknown,
  { protocols?: { href?: string[] } } | undefined,
]
const mentionAwareRehypePlugins = [
  defaultRehypePlugins.raw,
  [
    sanitizePlugin,
    {
      ...sanitizeSchema,
      protocols: {
        ...sanitizeSchema?.protocols,
        href: [...(sanitizeSchema?.protocols?.href ?? []), 'mention'],
      },
    },
  ],
  defaultRehypePlugins.harden,
] as ComponentProps<typeof Streamdown>['rehypePlugins']

// Renderer for `[label](mention://<type>/<UUID>)` markdown links in chat
// messages. Issues become IssueMentionCard chips so the user can hover-preview
// and click-to-open without leaving the conversation. Other mention types
// fall through to a styled badge for now.
const MENTION_URI = /^mention:\/\/(issue|agent|user)\/([0-9a-f-]+)$/i
function MentionAwareAnchor({
  href,
  children,
  node: _node,
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }) {
  const match = href ? MENTION_URI.exec(href) : null
  if (match) {
    const [, type, id] = match
    if (type === 'issue' && id) {
      const fallback =
        typeof children === 'string'
          ? children
          : Array.isArray(children) && typeof children[0] === 'string'
            ? (children[0] as string)
            : undefined
      return <IssueMentionCard issueId={id} fallbackLabel={fallback} />
    }
    return (
      <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
        {children}
      </span>
    )
  }
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}

const messageComponents = {
  a: MentionAwareAnchor as unknown as ComponentProps<
    typeof Streamdown
  >['components'] extends infer C
    ? C extends { a?: infer A }
      ? A
      : never
    : never,
}

export const MessageResponse = memo(
  ({ className, components, ...props }: MessageResponseProps) => (
    <Streamdown
      className={cn(
        'size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        className,
      )}
      plugins={streamdownPlugins}
      rehypePlugins={mentionAwareRehypePlugins}
      components={{ ...messageComponents, ...components }}
      {...props}
    />
  ),
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    nextProps.isAnimating === prevProps.isAnimating,
)

MessageResponse.displayName = 'MessageResponse'

export type MessageFooterProps = HTMLAttributes<HTMLDivElement>

/**
 * The action row under a message.
 *
 * No gap between the children on purpose: each action is a 32px square with its
 * own 8px padding, so butting them together is what puts the icons on the even
 * 32px rhythm the design specifies, and lines the first icon up with the
 * bubble's own left padding. An extra gap here pushed them out of that grid.
 */
export const MessageFooter = ({
  className,
  children,
  ...props
}: MessageFooterProps) => (
  <div
    className={cn(
      'flex items-center gap-0',
      'group-[.is-user]:ml-auto',
      className,
    )}
    {...props}
  >
    {children}
  </div>
)

export type MessageToolbarProps = ComponentProps<'div'>

export const MessageToolbar = ({
  className,
  children,
  ...props
}: MessageToolbarProps) => (
  <div
    className={cn(
      'mt-4 flex w-full items-center justify-between gap-4',
      className,
    )}
    {...props}
  >
    {children}
  </div>
)
