import type { ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

/**
 * Off-screen transform per preset. Presets animate the `transform` string,
 * not motion's `x`/`y`/`scale`: only `opacity` and `transform` run on the
 * compositor (motion-dom `acceleratedValues`), so the animation stays smooth
 * while the incoming content is still rendering on the main thread.
 */
const OFFSETS = {
  fade: null,
  'fade-up': 'translateY(12px)',
  'fade-down': 'translateY(-12px)',
  'fade-left': 'translateX(-12px)',
  'fade-right': 'translateX(12px)',
  scale: 'scale(0.97)',
} as const

/** Named enter/exit presets. `fade-left` slides in from the left. */
export type AnimateTransition = keyof typeof OFFSETS

/** Expo-style ease-out: a quick start that settles gently. */
export const ANIMATE_EASE = [0.22, 1, 0.36, 1] as const

/**
 * Enter/exit animation wrapper with a Mantine `Transition`-style API.
 * Content animates in when it mounts or `mounted` turns true, and animates out
 * before unmounting when `mounted` turns false. Give it a changing `key` to
 * replay the enter animation, e.g. per route section. Users who prefer
 * reduced motion get the opacity fade without movement.
 */
export function Animate({
  children,
  mounted = true,
  transition = 'fade',
  duration = 300,
  delay = 0,
  onExited,
  className,
}: {
  children: ReactNode
  mounted?: boolean
  transition?: AnimateTransition
  /** Milliseconds. */
  duration?: number
  /** Milliseconds before the enter animation starts. */
  delay?: number
  /** Called once the exit animation finishes and the content is gone. */
  onExited?: () => void
  className?: string
}) {
  const reduceMotion = useReducedMotion()
  const offset = reduceMotion ? null : OFFSETS[transition]
  const hidden = offset ? { opacity: 0, transform: offset } : { opacity: 0 }
  // `transitionEnd` drops the settled identity transform motion leaves inline,
  // which would otherwise make this wrapper the containing block for any
  // `position: fixed` descendant.
  const shown = offset
    ? { opacity: 1, transform: 'none', transitionEnd: { transform: 'none' } }
    : { opacity: 1 }
  const timing = { duration: duration / 1000, ease: ANIMATE_EASE }
  return (
    <AnimatePresence onExitComplete={onExited}>
      {mounted ? (
        <motion.div
          className={className}
          initial={hidden}
          animate={{ ...shown, transition: { ...timing, delay: delay / 1000 } }}
          exit={{ ...hidden, transition: timing }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
