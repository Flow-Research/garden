import type { CSSProperties, ReactNode } from 'react'
import './roadmap.css'
import {
  antiPriorities,
  architectureBoundaries,
  betaQuality,
  deferredUntilEvidence,
  launchGates,
  longHorizon,
  readinessGates,
  roadmapMeta,
  type IssueLink,
  type NotNowItem,
  type WorkItem,
  type WorkPriority,
} from './roadmap-copy'

/**
 * /roadmap keeps the existing parchment board treatment while presenting one
 * continuous Now → Next → Later read. Customer-specific and connector-inventory
 * views were removed because they obscured the actual Garden sequence.
 */
export function RoadmapPage() {
  return (
    <div className="roadmap-root min-h-dvh overflow-x-hidden">
      <div className="mx-auto max-w-5xl px-6 pb-24 sm:px-10">
        <Masthead />
        <main className="mt-16 sm:mt-20">
          <RoadmapOverview />
          <ArchitectureView />
          <NotNowView />
        </main>
        <Footer />
      </div>
    </div>
  )
}

/** Short page framing: enough why to interpret the order, not a product spec. */
function Masthead() {
  return (
    <header className="pt-12 sm:pt-16">
      <div className="roadmap-rise flex items-baseline justify-between gap-4">
        <div className="flex items-center gap-3">
          <SproutMark />
          <span className="text-[15px] font-medium tracking-tight">Garden</span>
          <span className="text-[13px] text-[color:var(--slate)]">Roadmap</span>
        </div>
        <span className="font-mono text-[11px] tabular-nums text-[color:var(--slate)]">
          {roadmapMeta.horizon} · {roadmapMeta.updated}
        </span>
      </div>
      <h1 className="roadmap-rise-2 mt-8 max-w-[24ch] text-balance text-[clamp(1.9rem,4.5vw,2.6rem)] font-semibold leading-[1.08] tracking-[-0.022em]">
        Make recurring work reliable.
      </h1>
      <p className="roadmap-rise-3 font-prose mt-4 max-w-[62ch] text-[15.5px] leading-7 text-[color:var(--gravel)]">
        {roadmapMeta.goal}
      </p>
      <div className="roadmap-rise-3 mt-8 grid gap-2 sm:grid-cols-3">
        <ContextCallout title="Dogfood first">
          Day-to-day use decides what gets fixed next.
        </ContextCallout>
        <ContextCallout title="Automations are core">
          Chat helps. Garden earns its keep when the work keeps running.
        </ContextCallout>
        <ContextCallout title="Improve, don't rewrite">
          Keep the current product. Fix it with design and engineering in the
          room.
        </ContextCallout>
      </div>
    </header>
  )
}

function ContextCallout({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div className="rounded-[var(--radius-card,0.75rem)] border border-[color:var(--hairline)] bg-[color:var(--vellum)] px-3.5 py-3">
      <p className="text-[12px] font-semibold text-[color:var(--ink)]">
        {title}
      </p>
      <p className="mt-1 text-[12px] leading-5 text-[color:var(--slate)]">
        {children}
      </p>
    </div>
  )
}

/** Tiny two-leaf sprout, retained from the original roadmap design. */
function SproutMark() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="text-[color:var(--moss)]"
    >
      <path
        d="M10 17.5v-6.2M10 11.3C10 8 7.8 5.8 4 5.5c.3 3.8 2.5 6 6 5.8ZM10 9.8c0-2.9 1.9-4.8 5.2-5-.2 3.3-2.1 5.2-5.2 5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ViewHeader({
  title,
  meta,
  lede,
}: {
  title: string
  meta?: string
  lede?: string
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 border-b border-[color:var(--hairline)] pb-3">
        <h2 className="text-[20px] font-semibold tracking-[-0.02em]">
          {title}
        </h2>
        {meta && (
          <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-[color:var(--slate)]">
            {meta}
          </span>
        )}
      </div>
      {lede && (
        <p className="font-prose mt-3 max-w-[66ch] text-[14.5px] leading-6.5 text-[color:var(--gravel)]">
          {lede}
        </p>
      )}
    </div>
  )
}

const priorityLabel: Record<WorkPriority, string> = {
  shipped: 'Shipped',
  high: 'High',
  medium: 'Medium',
  low: 'Long view',
}

const priorityColor: Record<WorkPriority, string> = {
  shipped: 'var(--moss)',
  high: 'var(--amber-ink)',
  medium: 'var(--gravel)',
  low: 'var(--stone)',
}

function PriorityTag({ priority }: { priority: WorkPriority }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium"
      style={{ color: priorityColor[priority] }}
    >
      <span
        className="roadmap-dot"
        style={{
          backgroundColor:
            priority === 'shipped' ? 'var(--moss)' : 'transparent',
          border:
            priority === 'shipped'
              ? 'none'
              : `1.5px solid ${priorityColor[priority]}`,
        }}
      />
      {priorityLabel[priority]}
    </span>
  )
}

function IssueLinks({ links }: { links?: IssueLink[] }) {
  if (!links?.length) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      {links.map((link) =>
        link.href ? (
          <a
            key={link.label}
            href={link.href}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[11px] text-[color:var(--moss)] underline decoration-[color:var(--hairline)] underline-offset-4 hover:decoration-[color:var(--moss)]"
          >
            {link.label} ↗
          </a>
        ) : (
          <span
            key={link.label}
            className="font-mono text-[11px] text-[color:var(--slate)]"
          >
            {link.label}
          </span>
        ),
      )}
    </span>
  )
}

const BOARD_COLUMNS: Array<{
  key: string
  label: string
  why: string
  color: string
  items: WorkItem[]
}> = [
  {
    key: 'now',
    label: 'Now',
    why: 'Use Garden ourselves. Fix what breaks and close the launch gaps.',
    color: 'var(--amber-ink)',
    items: launchGates,
  },
  {
    key: 'next',
    label: 'Next',
    why: 'Bring in a few pilots once our own workflows hold up.',
    color: 'var(--gravel)',
    items: betaQuality,
  },
  {
    key: 'later',
    label: 'Later',
    why: 'Build mini apps and a marketplace after people reuse the same patterns.',
    color: 'var(--moss)',
    items: longHorizon,
  },
]

/** Existing readiness vine plus a simpler Now / Next / Later board. */
function RoadmapOverview() {
  const done = readinessGates.filter((gate) => gate.status === 'done').length
  return (
    <section>
      <ViewHeader
        title="The sequence"
        meta={`${done} of ${readinessGates.length} gates passed`}
        lede="Use Garden on our own work until the rough edges stop surprising us. Then invite a few teams in. Bigger platform bets can wait."
      />
      <ol
        className="roadmap-vine mt-9 list-none"
        aria-label="Pilot-readiness gates"
      >
        {readinessGates.map((gate, index) => (
          <li
            key={gate.id}
            className="roadmap-gate"
            data-status={gate.status}
            style={{ '--gate-i': index } as CSSProperties}
          >
            <span className="roadmap-gate-node">
              {gate.status === 'done' && (
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 10 10"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M1.5 5.5 4 8l4.5-6"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
            <span className="roadmap-gate-label">{gate.label}</span>
          </li>
        ))}
      </ol>

      <div className="roadmap-board mt-12">
        {BOARD_COLUMNS.map((column) => (
          <section key={column.key} aria-labelledby={`${column.key}-title`}>
            <header>
              <div className="flex items-baseline gap-2">
                <span
                  className="roadmap-dot"
                  style={{ backgroundColor: column.color }}
                />
                <h3
                  id={`${column.key}-title`}
                  className="text-[14px] font-semibold"
                >
                  {column.label}
                </h3>
                <span className="ml-auto font-mono text-[11px] tabular-nums text-[color:var(--slate)]">
                  {column.items.length}
                </span>
              </div>
              <p className="mt-2 min-h-10 text-[11.5px] leading-5 text-[color:var(--slate)]">
                {column.why}
              </p>
            </header>
            <div className="mt-3 flex flex-col gap-2">
              {column.items.map((item) => (
                <details
                  key={`${item.ref}-${item.title}`}
                  className="roadmap-card"
                >
                  <summary>
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-[color:var(--slate)]">
                        {item.ref}
                      </span>
                      <PriorityTag priority={item.priority} />
                    </span>
                    <span className="mt-1.5 block text-[13.5px] font-medium leading-5 text-[color:var(--ink)]">
                      {item.title}
                    </span>
                    {item.note && (
                      <span className="mt-1 block font-mono text-[10.5px] text-[color:var(--moss)]">
                        {item.note}
                      </span>
                    )}
                  </summary>
                  <div className="roadmap-card-body">
                    <p className="text-[13px] leading-6 text-[color:var(--gravel)]">
                      {item.detail}
                    </p>
                    {item.evidence && (
                      <p className="mt-1.5 font-mono text-[10.5px] text-[color:var(--slate)]">
                        {item.evidence}
                      </p>
                    )}
                    <div className="mt-2">
                      <IssueLinks links={item.links} />
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  )
}

/** Short C4 extraction: only boundaries that affect current execution. */
function ArchitectureView() {
  return (
    <section className="mt-20">
      <ViewHeader
        title="Who owns what"
        lede="The full architecture is bigger than this page. These three boundaries are enough for the work in front of us."
      />
      <dl className="mt-6 divide-y divide-[color:var(--hairline-soft)] border-y border-[color:var(--hairline-soft)]">
        {architectureBoundaries.map((boundary) => (
          <div
            key={boundary.owner}
            className="grid gap-1 py-4 sm:grid-cols-[10rem_1fr] sm:gap-5"
          >
            <dt className="font-mono text-[11px] font-medium text-[color:var(--moss)]">
              {boundary.owner}
            </dt>
            <dd className="text-[13.5px] leading-6 text-[color:var(--gravel)]">
              {boundary.responsibility}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function NotNowList({
  items,
  marker,
}: {
  items: NotNowItem[]
  marker: (item: NotNowItem) => ReactNode
}) {
  return (
    <ul className="mt-3 list-none space-y-2.5">
      {items.map((item) => (
        <li
          key={item.text}
          className="flex gap-2.5 text-[13.5px] leading-6 text-[color:var(--gravel)]"
        >
          {marker(item)}
          <span>
            {item.text}
            {item.links && (
              <span className="ml-2">
                <IssueLinks links={item.links} />
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}

function NotNowView() {
  return (
    <section className="mt-20">
      <ViewHeader
        title="Deliberately not now"
        lede="Keep these visible so old customer assumptions and deferred ideas don't creep back into current work."
      />
      <div className="mt-8 grid gap-10 sm:grid-cols-2">
        <div>
          <h3 className="text-[12.5px] font-semibold">
            Deferred until evidence
          </h3>
          <NotNowList
            items={deferredUntilEvidence}
            marker={() => (
              <span
                aria-hidden="true"
                className="mt-[9px] h-px w-3 shrink-0 bg-[color:var(--stone)]"
              />
            )}
          />
        </div>
        <div>
          <h3 className="text-[12.5px] font-semibold text-[color:var(--clay-ink)]">
            Guardrails
          </h3>
          <NotNowList
            items={antiPriorities}
            marker={() => (
              <span
                aria-hidden="true"
                className="mt-[7px] shrink-0 font-mono text-[10px] leading-none text-[color:var(--clay-ink)]"
              >
                ×
              </span>
            )}
          />
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="mt-20 border-t border-[color:var(--hairline)] pt-5">
      <p className="text-[12px] leading-6 text-[color:var(--slate)]">
        Updated {roadmapMeta.updated} from{' '}
        {roadmapMeta.sources.map((source, index) => (
          <span key={source.label}>
            {index > 0 && ' · '}
            <span className="font-mono text-[11px] text-[color:var(--gravel)]">
              {source.label}
            </span>{' '}
            ({source.detail})
          </span>
        ))}
        . Execution details stay in the{' '}
        <a
          href={roadmapMeta.boardsUrl}
          target="_blank"
          rel="noreferrer"
          className="text-[color:var(--moss)] underline decoration-[color:var(--hairline)] underline-offset-4 hover:decoration-[color:var(--moss)]"
        >
          Garden issue tracker
        </a>
        .
      </p>
    </footer>
  )
}
