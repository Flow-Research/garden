import type { ReactNode } from 'react'
import {
  AnimatePresence,
  MotionConfig,
  motion,
  type TargetAndTransition,
} from 'motion/react'

const TRANSITIONS = {
  fade: { hidden: { opacity: 0 }, shown: { opacity: 1 } },
  'fade-up': { hidden: { opacity: 0, y: 12 }, shown: { opacity: 1, y: 0 } },
  'fade-down': { hidden: { opacity: 0, y: -12 }, shown: { opacity: 1, y: 0 } },
  'fade-left': { hidden: { opacity: 0, x: -16 }, shown: { opacity: 1, x: 0 } },
  'fade-right': { hidden: { opacity: 0, x: 16 }, shown: { opacity: 1, x: 0 } },
  scale: {
    hidden: { opacity: 0, scale: 0.96 },
    shown: { opacity: 1, scale: 1 },
  },
} as const satisfies Record<
  string,
  { hidden: TargetAndTransition; shown: TargetAndTransition }
>

/** Named enter/exit presets. `fade-left` slides in from the left. */
export type AnimateTransition = keyof typeof TRANSITIONS

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
  duration = 200,
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
  const { hidden, shown } = TRANSITIONS[transition]
  const timing = { duration: duration / 1000, ease: 'easeOut' } as const
  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence onExitComplete={onExited}>
        {mounted ? (
          <motion.div
            className={className}
            initial={hidden}
            animate={{
              ...shown,
              transition: { ...timing, delay: delay / 1000 },
            }}
            exit={{ ...hidden, transition: timing }}
          >
            {children}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </MotionConfig>
  )
}
