import {
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'

const DEFAULT_WIDTH = 380
const MIN_WIDTH = 280
const MIN_MAIL_WIDTH = 360
const KEYBOARD_STEP = 24
const STORAGE_KEY = 'garden:mail-agent-pane-width'

const clamp = (value: number, maximum: number) =>
  Math.min(Math.max(MIN_WIDTH, value), Math.max(MIN_WIDTH, maximum))

/** Restores the user's last deliberate pane size without adding mount effects. */
const initialWidth = () => {
  if (typeof window === 'undefined') return DEFAULT_WIDTH
  const stored = Number.parseInt(window.localStorage.getItem(STORAGE_KEY) ?? '')
  return Number.isFinite(stored) ? Math.max(MIN_WIDTH, stored) : DEFAULT_WIDTH
}

/**
 * Reuses Garden's document-side-panel drag direction for the Inbox agent.
 * Pointer capture keeps resize state local to the divider; the mail view and
 * agent runtime remain mounted independently on either side.
 */
export function MailAgentPane({ children }: { children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const activePointer = useRef<number | null>(null)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(DEFAULT_WIDTH)
  const [width, setWidth] = useState(initialWidth)

  const maximumWidth = () => {
    const hostWidth =
      panelRef.current?.parentElement?.getBoundingClientRect().width ??
      window.innerWidth
    return hostWidth - MIN_MAIL_WIDTH
  }

  const persist = (nextWidth: number) => {
    window.localStorage.setItem(STORAGE_KEY, String(Math.round(nextWidth)))
  }

  const resizeFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const direction = event.key === 'ArrowLeft' ? 1 : -1
    const nextWidth = clamp(width + direction * KEYBOARD_STEP, maximumWidth())
    setWidth(nextWidth)
    persist(nextWidth)
  }

  const beginResize = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    activePointer.current = event.pointerId
    dragStartX.current = event.clientX
    dragStartWidth.current = panelRef.current?.offsetWidth || width
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const continueResize = (event: PointerEvent<HTMLDivElement>) => {
    if (activePointer.current !== event.pointerId) return
    const nextWidth = clamp(
      dragStartWidth.current + dragStartX.current - event.clientX,
      maximumWidth(),
    )
    setWidth(nextWidth)
  }

  const finishResize = (event: PointerEvent<HTMLDivElement>) => {
    if (activePointer.current !== event.pointerId) return
    activePointer.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    persist(width)
  }

  return (
    <aside
      ref={panelRef}
      aria-label="Email agent"
      className="relative flex min-w-[280px] shrink-0 flex-col overflow-hidden border-l bg-background"
      style={{ width, maxWidth: `calc(100% - ${MIN_MAIL_WIDTH}px)` }}
    >
      <div
        role="separator"
        aria-label="Resize agent panel"
        aria-orientation="vertical"
        aria-valuemin={MIN_WIDTH}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        onKeyDown={resizeFromKeyboard}
        onPointerDown={beginResize}
        onPointerMove={continueResize}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        className="group absolute inset-y-0 left-0 z-20 w-2 -translate-x-1 cursor-col-resize touch-none outline-none"
      >
        <span className="absolute inset-y-0 left-1/2 w-px bg-border transition-colors group-hover:bg-foreground/35 group-focus-visible:bg-ring" />
      </div>
      {children}
    </aside>
  )
}
