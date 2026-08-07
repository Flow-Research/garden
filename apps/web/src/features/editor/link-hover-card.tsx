import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { computePosition, flip, offset, shift } from '@floating-ui/dom'
import { Copy, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@garden/ui/components/ui/button'
import { isMentionHref, openLink } from './utils/link-handler'

const OPEN_DELAY_MS = 300
const CLOSE_DELAY_MS = 150

interface LinkPreviewState {
  anchor: HTMLAnchorElement
  href: string
}

function displayUrl(href: string, limit = 48): string {
  if (href.length <= limit) return href
  if (!URL.canParse(href)) return `${href.slice(0, limit - 1)}…`
  const parsed = new URL(href)
  const remaining = href.slice(parsed.origin.length)
  if (remaining.length <= 10) return href
  return `${parsed.origin}${remaining.slice(0, Math.max(0, limit - parsed.origin.length - 1))}…`
}

function eligibleAnchor(target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof Element)) return null
  const anchor = target.closest<HTMLAnchorElement>('a')
  const href = anchor?.getAttribute('href')
  if (
    !anchor ||
    !href ||
    isMentionHref(href) ||
    anchor.classList.contains('issue-mention')
  ) {
    return null
  }
  return anchor
}

/**
 * Attaches delegated hover listeners through a React 19 callback-ref cleanup.
 * This keeps DOM subscription ownership at the rendered container boundary.
 */
function useLinkHover(disabled = false) {
  const [preview, setPreview] = useState<LinkPreviewState | null>(null)
  const openTimer = useRef(0)
  const closeTimer = useRef(0)
  const cardRef = useRef<HTMLDivElement>(null)

  const cancelTimers = () => {
    window.clearTimeout(openTimer.current)
    window.clearTimeout(closeTimer.current)
  }

  const scheduleClose = () => {
    window.clearTimeout(openTimer.current)
    closeTimer.current = window.setTimeout(
      () => setPreview(null),
      CLOSE_DELAY_MS,
    )
  }

  const containerRef = useCallback(
    (container: HTMLElement | null) => {
      if (!container || disabled) return

      const handleOver = (event: MouseEvent) => {
        const anchor = eligibleAnchor(event.target)
        if (!anchor) return
        window.clearTimeout(closeTimer.current)
        window.clearTimeout(openTimer.current)
        openTimer.current = window.setTimeout(() => {
          setPreview({ anchor, href: anchor.getAttribute('href') ?? '' })
        }, OPEN_DELAY_MS)
      }

      const handleOut = (event: MouseEvent) => {
        if (
          event.relatedTarget instanceof Node &&
          cardRef.current?.contains(event.relatedTarget)
        ) {
          return
        }
        const anchor = eligibleAnchor(event.target)
        if (
          anchor &&
          event.relatedTarget instanceof Node &&
          anchor.contains(event.relatedTarget)
        ) {
          return
        }
        scheduleClose()
      }

      container.addEventListener('mouseover', handleOver)
      container.addEventListener('mouseout', handleOut)
      return () => {
        container.removeEventListener('mouseover', handleOver)
        container.removeEventListener('mouseout', handleOut)
        cancelTimers()
      }
    },
    [disabled],
  )

  return {
    containerRef,
    preview,
    cardRef,
    onCardEnter: () => window.clearTimeout(closeTimer.current),
    onCardLeave: scheduleClose,
  }
}

/** Floating actions for a normal URL discovered by `useLinkHover`. */
function LinkHoverCard({
  preview,
  cardRef,
  onCardEnter,
  onCardLeave,
}: ReturnType<typeof useLinkHover>) {
  const positionCard = useCallback(
    (node: HTMLDivElement | null) => {
      cardRef.current = node
      if (!node || !preview) return
      node.style.visibility = 'hidden'
      void computePosition(preview.anchor, node, {
        placement: 'bottom-start',
        strategy: 'fixed',
        middleware: [offset(4), flip(), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        if (cardRef.current !== node) return
        node.style.left = `${x}px`
        node.style.top = `${y}px`
        node.style.visibility = 'visible'
      })
      return () => {
        if (cardRef.current === node) cardRef.current = null
      }
    },
    [cardRef, preview],
  )

  if (!preview) return null

  const preventEditorMouseDown = (event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }

  return createPortal(
    <div
      ref={positionCard}
      className="link-hover-card fixed z-50"
      onMouseEnter={onCardEnter}
      onMouseLeave={onCardLeave}
    >
      <span
        className="min-w-0 flex-1 truncate px-1 text-xs text-muted-foreground"
        title={preview.href}
      >
        {displayUrl(preview.href)}
      </span>
      <Button
        size="icon-xs"
        variant="ghost"
        className="text-muted-foreground"
        title="Copy link"
        onMouseDown={preventEditorMouseDown}
        onClick={() => {
          void navigator.clipboard.writeText(preview.href).then(
            () => toast.success('Link copied'),
            () => toast.error('Failed to copy'),
          )
        }}
      >
        <Copy />
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        className="text-muted-foreground"
        title="Open link"
        onMouseDown={preventEditorMouseDown}
        onClick={() => openLink(preview.href)}
      >
        <ExternalLink />
      </Button>
    </div>,
    document.body,
  )
}

export { useLinkHover, LinkHoverCard }
