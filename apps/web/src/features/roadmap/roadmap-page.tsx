import type { CSSProperties, ReactNode } from 'react'
import { getRouteApi } from '@tanstack/react-router'
import './roadmap.css'
import {
  antiPriorities,
  betaQuality,
  connectorTrust,
  deferredUntilEvidence,
  launchGates,
  pilotStance,
  pilotWeeks,
  readinessGates,
  roadmapMeta,
  shippedRecently,
  type IssueLink,
  type NotNowItem,
  type PilotWeekId,
  type WorkItem,
  type WorkPriority,
} from './roadmap-copy'

/** The selectable views; also the valid values for the ?view= param. */
export const roadmapViews = ['overview', 'pilot', 'connectors', 'notnow'] as const
export type RoadmapView = (typeof roadmapViews)[number]

const route = getRouteApi('/roadmap')

/**
 * /roadmap — Garden's roadmap as a click-through console rather than a long
 * read. A sticky rail (chip bar on mobile) switches between four views, each
 * roughly a screenful: an overview status board (Now / Next / Shipped columns
 * in the public-roadmap tradition), the pilot plan with the garden-path week
 * selector, the connector trust inventory, and the explicit not-now list.
 * Tracker issues are folded in contextually — every work item carries its
 * FLO/GH references as chips (linked when public) instead of the page hosting
 * an issue-board dump. View + selected week live in search params
 * (validateSearch on the route), so every state is a shareable URL and SSR
 * matches hydration. Content comes from roadmap-copy.ts, a hand-reconciled
 * snapshot of docs/known-gaps, docs/roadmap.md, both issue trackers, and the
 * pilot-plan xlsx.
 */
export function RoadmapPage() {
  const { view = 'overview', week = 'now' } = route.useSearch()
  return (
    <div className="roadmap-root h-dvh overflow-y-auto overscroll-y-contain">
      <div className="mx-auto max-w-5xl px-6 pb-24 sm:px-10">
        <Masthead />
        <MobileNav active={view} />
        <div className="mt-8 gap-14 lg:grid lg:grid-cols-[11.5rem_minmax(0,1fr)]">
          <Rail active={view} />
          {/* key={view} remounts the pane so the entrance plays per switch. */}
          <main key={view} className="roadmap-view min-w-0">
            {view === 'overview' && <OverviewView />}
            {view === 'pilot' && <PilotView week={week} />}
            {view === 'connectors' && <ConnectorsView />}
            {view === 'notnow' && <NotNowView />}
          </main>
        </div>
        <Footer />
      </div>
    </div>
  )
}

/* ── Navigation ──────────────────────────────────────────────────────────── */

const NAV_ITEMS: Array<{ view: RoadmapView; label: string; count?: number }> = [
  { view: 'overview', label: 'Overview' },
  { view: 'pilot', label: 'Pilot plan', count: pilotWeeks.length },
  { view: 'connectors', label: 'Connector trust', count: connectorTrust.length },
  { view: 'notnow', label: 'Not now', count: deferredUntilEvidence.length + antiPriorities.length },
]

/** One nav link, shared by the rail and the mobile chip bar. */
function NavLink({
  item,
  active,
  chip,
}: {
  item: (typeof NAV_ITEMS)[number]
  active: boolean
  chip?: boolean
}) {
  const Link = route.Link
  return (
    <Link
      search={(prev) => ({ ...prev, view: item.view === 'overview' ? undefined : item.view })}
      resetScroll={false}
      className={chip ? 'roadmap-chip' : 'roadmap-rail-link'}
      data-active={active || undefined}
      aria-current={active ? 'page' : undefined}
    >
      <span>{item.label}</span>
      {item.count !== undefined && (
        <span className="roadmap-nav-count font-mono tabular-nums">{item.count}</span>
      )}
    </Link>
  )
}

/** Desktop rail: sticky view switcher with counts and a readiness footer. */
function Rail({ active }: { active: RoadmapView }) {
  const done = readinessGates.filter((g) => g.status === 'done').length
  return (
    <aside className="roadmap-rise-2 hidden lg:block">
      <nav aria-label="Roadmap views" className="sticky top-10 flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.view} item={item} active={active === item.view} />
        ))}
        <div className="mt-8 border-t border-[color:var(--hairline-soft)] pt-4">
          <div className="flex items-center gap-2">
            <span className="roadmap-dot" style={{ backgroundColor: 'var(--moss)' }} />
            <span className="font-mono text-[11px] tabular-nums text-[color:var(--gravel)]">
              {done}/{readinessGates.length} gates
            </span>
          </div>
          <p className="mt-2 text-[11.5px] leading-5 text-[color:var(--slate)]">
            Beta opens when all seven pass.
          </p>
          <a
            href={roadmapMeta.boardsUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-block font-mono text-[11px] text-[color:var(--gravel)] underline decoration-[color:var(--hairline)] underline-offset-4 transition-colors hover:text-[color:var(--moss)] hover:decoration-[color:var(--moss)]"
          >
            all issues ↗
          </a>
        </div>
      </nav>
    </aside>
  )
}

/** Mobile: sticky horizontal chip bar with the same links. */
function MobileNav({ active }: { active: RoadmapView }) {
  return (
    <nav
      aria-label="Roadmap views"
      className="roadmap-chipbar sticky top-0 z-10 -mx-6 mt-6 flex gap-1.5 overflow-x-auto px-6 py-3 sm:-mx-10 sm:px-10 lg:hidden"
    >
      {NAV_ITEMS.map((item) => (
        <NavLink key={item.view} item={item} active={active === item.view} chip />
      ))}
    </nav>
  )
}

/* ── Masthead ────────────────────────────────────────────────────────────── */

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
        The road to a garden worth visiting.
      </h1>
      <p className="roadmap-rise-3 font-prose mt-4 max-w-[58ch] text-[15.5px] leading-7 text-[color:var(--gravel)]">
        {roadmapMeta.goal}
      </p>
    </header>
  )
}

/** Tiny two-leaf sprout, the page's only wordmark ornament. */
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

/* ── Shared view scaffolding ─────────────────────────────────────────────── */

/** View header: title left, factual mono meta right, optional short lede. */
function ViewHeader({ title, meta, lede }: { title: string; meta?: string; lede?: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 border-b border-[color:var(--hairline)] pb-3">
        <h2 className="text-[20px] font-semibold tracking-[-0.02em]">{title}</h2>
        {meta && (
          <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-[color:var(--slate)]">
            {meta}
          </span>
        )}
      </div>
      {lede && (
        <p className="font-prose mt-3 max-w-[62ch] text-[14.5px] leading-6.5 text-[color:var(--gravel)]">
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
  low: 'Low',
}

const priorityColor: Record<WorkPriority, string> = {
  shipped: 'var(--moss)',
  high: 'var(--amber-ink)',
  medium: 'var(--gravel)',
  low: 'var(--stone)',
}

/** Dot + text priority chip; color never carries the state alone. */
function PriorityTag({ priority }: { priority: WorkPriority }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium"
      style={{ color: priorityColor[priority] }}
    >
      <span
        className="roadmap-dot"
        style={{
          backgroundColor: priority === 'shipped' ? 'var(--moss)' : 'transparent',
          border: priority === 'shipped' ? 'none' : `1.5px solid ${priorityColor[priority]}`,
        }}
      />
      {priorityLabel[priority]}
    </span>
  )
}

/** Tracker reference chips — linked when the tracker is public. */
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
            className="font-mono text-[11px] tabular-nums text-[color:var(--moss)] underline decoration-[color:var(--hairline)] underline-offset-4 transition-colors hover:decoration-[color:var(--moss)]"
          >
            {link.label} ↗
          </a>
        ) : (
          <span
            key={link.label}
            className="font-mono text-[11px] tabular-nums text-[color:var(--slate)]"
          >
            {link.label}
          </span>
        ),
      )}
    </span>
  )
}

/** Caret that rotates when the enclosing <details> opens. */
function Caret() {
  return (
    <svg
      className="roadmap-caret shrink-0"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 1.5 6.5 5 3 8.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * One-line scannable row that expands for the why — changelog density on the
 * face, full detail one click away, zero JS state.
 */
function LineRow({ item }: { item: WorkItem }) {
  return (
    <details className="roadmap-line" data-shipped={item.priority === 'shipped' || undefined}>
      <summary>
        <span className="w-16 shrink-0 font-mono text-[12px] tabular-nums text-[color:var(--ink)]">
          {item.ref}
        </span>
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{item.title}</span>
        {item.note && (
          <span className="hidden shrink-0 font-mono text-[10.5px] text-[color:var(--moss)] sm:inline">
            {item.note}
          </span>
        )}
        <PriorityTag priority={item.priority} />
        <Caret />
      </summary>
      <div className="roadmap-line-body">
        <p className="max-w-[68ch] text-[14px] leading-6.5 text-[color:var(--gravel)]">
          {item.detail}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {item.evidence && (
            <span className="font-mono text-[11px] text-[color:var(--slate)]">
              {item.evidence}
            </span>
          )}
          <IssueLinks links={item.links} />
        </div>
      </div>
    </details>
  )
}

/* ── Overview ────────────────────────────────────────────────────────────── */

const BOARD_COLUMNS: Array<{
  key: string
  label: string
  color: string
  items: WorkItem[]
}> = [
  { key: 'now', label: 'Now — launch gates', color: 'var(--amber-ink)', items: launchGates },
  { key: 'next', label: 'Next — beta quality', color: 'var(--gravel)', items: betaQuality },
  { key: 'shipped', label: 'Shipped', color: 'var(--moss)', items: shippedRecently },
]

/** Readiness vine + the Now / Next / Shipped status board. */
function OverviewView() {
  const done = readinessGates.filter((g) => g.status === 'done').length
  return (
    <div>
      <ViewHeader
        title="Where the bar sits"
        meta={`${done} of ${readinessGates.length} gates passed`}
        lede="Beta opens when every gate on this line is green. The board below is the work, sorted by when it matters — open any card for the why and its tracker links."
      />
      <ol className="roadmap-vine mt-9 list-none" aria-label="Beta readiness gates">
        {readinessGates.map((gate, i) => (
          <li
            key={gate.id}
            className="roadmap-gate"
            data-status={gate.status}
            style={{ '--gate-i': i } as CSSProperties}
          >
            <span className="roadmap-gate-node">
              {gate.status === 'done' && (
                <svg width="11" height="11" viewBox="0 0 10 10" fill="none" aria-hidden="true">
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
            <span className="roadmap-gate-label">
              {gate.label}
              <span className="sr-only">{gate.status === 'done' ? ' — passed' : ' — open'}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="roadmap-board mt-12">
        {BOARD_COLUMNS.map((col) => (
          <section key={col.key} aria-label={col.label}>
            <header className="flex items-baseline gap-2">
              <span className="roadmap-dot" style={{ backgroundColor: col.color }} />
              <h3 className="text-[12.5px] font-semibold tracking-[-0.01em]">{col.label}</h3>
              <span className="ml-auto font-mono text-[11px] tabular-nums text-[color:var(--slate)]">
                {col.items.length}
              </span>
            </header>
            <div className="mt-3 flex flex-col gap-2">
              {col.items.map((item) => (
                <details key={`${item.ref}-${item.title}`} className="roadmap-card">
                  <summary>
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] tabular-nums text-[color:var(--slate)]">
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
    </div>
  )
}

/* ── Pilot plan ──────────────────────────────────────────────────────────── */

const PATH_STATIONS: Array<{ id: PilotWeekId; label: string; x: number; y: number }> = [
  { id: 'now', label: 'Now', x: 52, y: 216 },
  { id: 'w1', label: 'W1', x: 144, y: 206 },
  { id: 'w2', label: 'W2', x: 238, y: 188 },
  { id: 'w3', label: 'W3', x: 326, y: 162 },
  { id: 'w4', label: 'W4', x: 404, y: 134 },
  { id: 'w5', label: 'W5', x: 474, y: 110 },
  { id: 'w6', label: 'W6', x: 538, y: 90 },
  { id: 'w78', label: 'W7–8', x: 600, y: 72 },
  { id: 'later', label: 'Later', x: 656, y: 56 },
]

const TRAIL_D =
  'M 52 216 C 88 214, 112 212, 144 206 S 205 196, 238 188 S 296 172, 326 162 S 378 143, 404 134 S 450 118, 474 110 S 516 96, 538 90 S 580 77, 600 72 S 640 60, 656 56 L 676 50'

/**
 * The pilot plan drawn as a garden trail — and it IS the week selector:
 * clicking a station swaps the entry below, one week on screen at a time.
 */
function GardenPath({ selected }: { selected: PilotWeekId }) {
  const navigate = route.useNavigate()
  return (
    <figure className="roadmap-path-figure hidden sm:block">
      <svg viewBox="0 0 720 268" aria-label="Pilot plan week selector, drawn as a garden path">
        <path className="roadmap-trail" d={TRAIL_D} strokeWidth="2.5" fill="none" />
        <g
          transform="translate(688, 34)"
          stroke="var(--moss)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          aria-hidden="true"
        >
          <path d="M0 14v-6.5M0 7.5C0 4 -2.4 1.8 -6.2 1.5c.3 3.9 2.6 6.2 6.2 6ZM0 6c0-3 2-5 5.4-5.2C5.2 4.2 3.2 6.2 0 6Z" />
        </g>
        <text
          x="688"
          y="62"
          textAnchor="middle"
          fill="var(--moss)"
          fontFamily="var(--font-mono)"
          fontSize="10.5"
          fontWeight="500"
        >
          beta
        </text>

        {PATH_STATIONS.map((station, i) => (
          <a
            key={station.id}
            href={`/roadmap?view=pilot&week=${station.id}`}
            onClick={(event) => {
              event.preventDefault()
              navigate({
                search: (prev) => ({ ...prev, view: 'pilot', week: station.id }),
                resetScroll: false,
              })
            }}
            className="roadmap-station"
            data-current={station.id === selected || undefined}
            style={{ '--station-i': i } as CSSProperties}
            aria-label={`Show ${station.label}`}
          >
            {station.id === selected && (
              <circle className="roadmap-station-pulse" cx={station.x} cy={station.y} r="12" />
            )}
            <circle cx={station.x} cy={station.y} r="6" />
            <text x={station.x} y={station.y + 24} textAnchor="middle">
              {station.label}
            </text>
          </a>
        ))}
      </svg>
    </figure>
  )
}

/** One pilot week at a time: goal, four lanes, exit criterion, prev/next. */
function PilotView({ week }: { week: PilotWeekId }) {
  const Link = route.Link
  const index = pilotWeeks.findIndex((w) => w.id === week)
  const current = pilotWeeks[index] ?? pilotWeeks[0]
  const prev = pilotWeeks[index - 1]
  const next = pilotWeeks[index + 1]
  return (
    <div>
      <ViewHeader
        title="The pilot plan"
        meta={`phase ${index + 1} of ${pilotWeeks.length}`}
        lede={pilotStance}
      />
      <GardenPath selected={current.id} />

      {/* Week chips — the selector on small screens, quick-jump elsewhere. */}
      <div className="mt-5 flex flex-wrap gap-1.5 sm:hidden">
        {pilotWeeks.map((w) => (
          <Link
            key={w.id}
            search={(prevSearch) => ({ ...prevSearch, view: 'pilot', week: w.id })}
            resetScroll={false}
            className="roadmap-chip"
            data-active={w.id === current.id || undefined}
          >
            {w.label}
          </Link>
        ))}
      </div>

      <article key={current.id} className="roadmap-view mt-8" aria-live="polite">
        <div className="flex items-center gap-3">
          <span className="roadmap-week-seal" data-current={current.id === 'now' || undefined}>
            {current.label}
          </span>
          <h3 className="text-[17px] font-medium leading-6">{current.goal}</h3>
        </div>
        <div className="roadmap-lanes mt-6">
          {current.lanes.map((lane) => (
            <div key={lane.lane}>
              <div className="text-[11px] font-medium tracking-[0.02em] text-[color:var(--moss)]">
                {lane.lane}
              </div>
              <p className="mt-1 text-[13.5px] leading-6 text-[color:var(--gravel)]">
                {lane.work}
              </p>
            </div>
          ))}
        </div>
        <p className="roadmap-done-when mt-6 text-[14px] leading-6.5">
          Done when — {current.doneWhen}
        </p>
        <div className="mt-8 flex items-center justify-between border-t border-[color:var(--hairline-soft)] pt-4">
          {prev ? (
            <Link
              search={(prevSearch) => ({ ...prevSearch, view: 'pilot', week: prev.id })}
              resetScroll={false}
              className="roadmap-pager"
            >
              ← {prev.label}
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link
              search={(prevSearch) => ({ ...prevSearch, view: 'pilot', week: next.id })}
              resetScroll={false}
              className="roadmap-pager"
            >
              {next.label} →
            </Link>
          )}
        </div>
      </article>
    </div>
  )
}

/* ── Connector trust ─────────────────────────────────────────────────────── */

function ConnectorsView() {
  return (
    <div>
      <ViewHeader
        title="Connector trust"
        meta={`${connectorTrust.length} open`}
        lede="Connectors are Garden's riskiest surface — external reads and writes on a user's behalf. This is what still stands between 'works' and 'trustworthy'."
      />
      <div className="mt-6 border-t border-[color:var(--hairline-soft)]">
        {connectorTrust.map((item) => (
          <LineRow key={`${item.ref}-${item.title}`} item={item} />
        ))}
      </div>
    </div>
  )
}

/* ── Not now ─────────────────────────────────────────────────────────────── */

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
    <div>
      <ViewHeader
        title="Deliberately not now"
        lede="Half of a roadmap is what it refuses. These are decisions, not omissions — deferred bets keep their tracker links for when evidence arrives, and the second list is a standing no."
      />
      <div className="mt-8 grid gap-10 sm:grid-cols-2">
        <div>
          <h3 className="text-[12.5px] font-semibold text-[color:var(--ink)]">
            Deferred until evidence
          </h3>
          <NotNowList
            items={deferredUntilEvidence}
            marker={() => (
              <span
                aria-hidden="true"
                className="mt-[9px] h-px w-3 flex-shrink-0 bg-[color:var(--stone)]"
              />
            )}
          />
        </div>
        <div>
          <h3 className="text-[12.5px] font-semibold text-[color:var(--clay-ink)]">
            Anti-priorities
          </h3>
          <NotNowList
            items={antiPriorities}
            marker={() => (
              <span
                aria-hidden="true"
                className="mt-[7px] flex-shrink-0 font-mono text-[10px] leading-none text-[color:var(--clay-ink)]"
              >
                ×
              </span>
            )}
          />
        </div>
      </div>
    </div>
  )
}

function Footer() {
  return (
    <footer className="mt-20 border-t border-[color:var(--hairline)] pt-5">
      <p className="text-[12px] leading-6 text-[color:var(--slate)]">
        Reconciled {roadmapMeta.updated} from{' '}
        {roadmapMeta.sources.map((s, i) => (
          <span key={s.label}>
            {i > 0 && ' · '}
            <span className="font-mono text-[11px] text-[color:var(--gravel)]">{s.label}</span>{' '}
            ({s.detail})
          </span>
        ))}
        . The trackers stay the system of record —{' '}
        <a
          href={roadmapMeta.boardsUrl}
          target="_blank"
          rel="noreferrer"
          className="text-[color:var(--moss)] underline decoration-[color:var(--hairline)] underline-offset-4 hover:decoration-[color:var(--moss)]"
        >
          github.com/Flow-Research/garden
        </a>
        .
      </p>
    </footer>
  )
}
