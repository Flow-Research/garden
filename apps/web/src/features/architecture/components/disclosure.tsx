import type { ReactNode } from 'react'

/**
 * Progressive-disclosure row built on native <details>/<summary>. No JS, no
 * hydration cost, keyboard-accessible for free, and SSR-correct. Used for the
 * building-block accordion and "go deeper" asides so the page reads shallow on a
 * skim and deep on demand, instead of forcing one fixed density on everyone.
 */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
}: {
  summary: ReactNode
  children: ReactNode
  defaultOpen?: boolean
}) {
  return (
    <details className="arch-disclosure" open={defaultOpen}>
      <summary>
        <Caret />
        <div className="min-w-0 flex-1">{summary}</div>
      </summary>
      <div className="pb-5 pl-[1.4rem]">{children}</div>
    </details>
  )
}

function Caret() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden
      className="arch-caret mt-1 shrink-0"
    >
      <path
        d="M3 1.5 L7 5 L3 8.5"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
    </svg>
  )
}
