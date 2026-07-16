import type { CSSProperties, ReactNode } from 'react'
import './roadmap.css'
import {
  antiPriorities,
  betaQuality,
  connectorTrust,
  deferredUntilEvidence,
  githubGroups,
  githubIssueUrl,
  launchGates,
  pilotStance,
  pilotWeeks,
  readinessGates,
  roadmapMeta,
  roadmapToc,
  workspaceBoard,
  type WorkItem,
  type WorkPriority,
} from './roadmap-copy'

/**
 * /roadmap — Garden's roadmap as one readable page: a hero garden path
 * plotting the pilot plan, readiness gates, launch blockers, beta quality
 * work, connector trust inventory, the week-by-week plan, both issue boards,
 * and the explicit not-now list. Public, light parchment (see roadmap.css),
 * fully static and SSR-safe — all content comes from roadmap-copy.ts, which
 * reconciles docs/known-gaps, docs/roadmap.md, the workspace board, GitHub
 * issues, and the pilot-plan xlsx into one snapshot.
 */
export function RoadmapPage() {
  return (
    <div className="roadmap-root h-dvh overflow-y-auto overscroll-y-contain">
      <div className="mx-auto max-w-3xl px-6 pb-32 sm:px-10">
        <Masthead />
        <Readiness />

        <Section
          id="gates"
          title="Launch gates"
          meta={sectionMeta(launchGates)}
          lede="Must land before beta. Everything here is a ship-safety concern, not a feature."
        >
          <WorkRows items={launchGates} />
        </Section>

        <Section
          id="quality"
          title="Beta quality"
          meta={sectionMeta(betaQuality)}
          lede="Work that makes the narrow product feel dependable for the first testers."
        >
          <WorkRows items={betaQuality} />
        </Section>

        <Section
          id="connectors"
          title="Connector trust"
          meta={sectionMeta(connectorTrust)}
          lede="Connectors are Garden's riskiest surface — external reads and writes on a user's behalf. This inventory tracks what still stands between 'works' and 'trustworthy'."
        >
          <WorkRows items={connectorTrust} />
        </Section>

        <PilotPlan />
        <Boards />
        <NotNow />
        <Footer />
      </div>
    </div>
  )
}

/** "n open · n shipped" summary for a section header. */
function sectionMeta(items: WorkItem[]): string {
  const shipped = items.filter((i) => i.priority === 'shipped').length
  const open = items.length - shipped
  return shipped > 0 ? `${open} open · ${shipped} shipped` : `${open} open`
}

function Masthead() {
  return (
    <header className="pt-16 sm:pt-24">
      <div className="roadmap-rise flex items-baseline justify-between gap-4">
        <div className="flex items-center gap-3">
          <SproutMark />
          <span className="text-[15px] font-medium tracking-tight">Garden</span>
        </div>
        <span className="font-mono text-[11px] text-[color:var(--slate)]">
          {roadmapMeta.updated}
        </span>
      </div>

      <h1 className="roadmap-rise-2 mt-10 text-balance text-[clamp(2.4rem,7vw,3.6rem)] font-semibold leading-[1.04] tracking-[-0.025em]">
        The roadmap
        <span className="block text-[color:var(--gravel)]">to a garden worth visiting.</span>
      </h1>

      <div className="roadmap-rise-3 mt-8 max-w-[62ch]">
        <p className="font-prose text-[17px] leading-8 text-[color:var(--gravel)]">
          {roadmapMeta.goal}
        </p>
        <p className="font-prose mt-4 text-[15px] leading-7 text-[color:var(--gravel)]">
          {pilotStance}
        </p>
      </div>

      <GardenPath />

      <nav
        aria-label="On this page"
        className="roadmap-rise-3 mt-10 flex flex-wrap gap-x-5 gap-y-2 border-y border-[color:var(--hairline)] py-3"
      >
        <span className="text-[12px] font-medium text-[color:var(--slate)]">
          {roadmapMeta.horizon}
        </span>
        {roadmapToc.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className="text-[12px] text-[color:var(--gravel)] transition-colors hover:text-[color:var(--ink)]"
          >
            {item.label}
          </a>
        ))}
      </nav>
    </header>
  )
}

/**
 * Hero figure: the pilot plan drawn as a garden trail rising from Now to
 * Later, ending at the beta horizon. Station coordinates are hand-placed
 * along the drawn curve; each station is a real anchor into the week-by-week
 * section, so the figure is navigation, not decoration. Hidden on small
 * screens where the scaled-down labels stop being legible — the timeline
 * below carries the same content.
 */
const PATH_STATIONS: Array<{ id: string; label: string; x: number; y: number }> = [
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

function GardenPath() {
  return (
    <figure className="roadmap-path-figure hidden sm:block">
      <svg viewBox="0 0 720 268" aria-label="The pilot plan as a garden path from Now to Later">
        <path className="roadmap-trail" d={TRAIL_D} strokeWidth="2.5" fill="none" />

        {/* The beta horizon — a sprout at the end of the trail. */}
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
            href={`#week-${station.id}`}
            className="roadmap-station"
            data-current={station.id === 'now' || undefined}
            style={{ '--station-i': i } as CSSProperties}
            aria-label={`Jump to ${station.label} in the pilot plan`}
          >
            {station.id === 'now' && (
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

/** The seven beta-readiness gates strung on the vine. */
function Readiness() {
  const done = readinessGates.filter((g) => g.status === 'done').length
  return (
    <Section
      id="readiness"
      title="Where the bar sits"
      meta={`${done} of ${readinessGates.length} gates passed`}
      lede="Beta opens when every gate on this line is green. One is; the rest are the work below."
    >
      <ol className="roadmap-vine mt-10 list-none" aria-label="Beta readiness gates">
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
    </Section>
  )
}

/** Anchorable page section: title left, factual count right, optional lede. */
function Section({
  id,
  title,
  meta,
  lede,
  children,
}: {
  id: string
  title: string
  meta?: string
  lede?: string
  children: ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-10 pt-20">
      <div className="flex items-baseline justify-between gap-4 border-b border-[color:var(--hairline)] pb-3">
        <h2 className="text-[24px] font-semibold tracking-[-0.02em]">{title}</h2>
        {meta && (
          <span className="whitespace-nowrap font-mono text-[11px] text-[color:var(--slate)]">
            {meta}
          </span>
        )}
      </div>
      {lede && (
        <p className="font-prose mt-4 max-w-[62ch] text-[15px] leading-7 text-[color:var(--gravel)]">
          {lede}
        </p>
      )}
      <div className="mt-6">{children}</div>
    </section>
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
      className="inline-flex items-center gap-1.5 text-[11px] font-medium"
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

/** Hairline-ruled work rows: ref chip + priority in the margin, prose beside. */
function WorkRows({ items, linkRefs = false }: { items: WorkItem[]; linkRefs?: boolean }) {
  return (
    <div className="border-t border-[color:var(--hairline-soft)]">
      {items.map((item) => {
        const refChip = (
          <span className="font-mono text-[12px] text-[color:var(--ink)]">{item.ref}</span>
        )
        return (
          <article
            key={`${item.ref}-${item.title}`}
            className="roadmap-row"
            data-shipped={item.priority === 'shipped' || undefined}
          >
            <div className="flex flex-row items-baseline gap-3 sm:flex-col sm:gap-1.5">
              {linkRefs && item.ref.startsWith('#') ? (
                <a
                  href={githubIssueUrl(Number(item.ref.slice(1)))}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-[color:var(--hairline)] underline-offset-4 transition-colors hover:decoration-[color:var(--moss)]"
                >
                  {refChip}
                </a>
              ) : (
                refChip
              )}
              <PriorityTag priority={item.priority} />
            </div>
            <div className="min-w-0">
              <h3 className="text-[15px] font-medium leading-6">
                {item.title}
                {item.note && (
                  <span className="ml-2 font-mono text-[11px] font-normal text-[color:var(--moss)]">
                    {item.note}
                  </span>
                )}
              </h3>
              <p className="mt-1 text-[14px] leading-6.5 text-[color:var(--gravel)]">
                {item.detail}
              </p>
              {item.evidence && (
                <p className="mt-1.5 font-mono text-[11px] text-[color:var(--slate)]">
                  {item.evidence}
                </p>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}

/** The Moniepoint pilot plan — the hero trail walked slowly, week by week. */
function PilotPlan() {
  return (
    <Section
      id="pilot"
      title="The pilot plan, week by week"
      meta={`${pilotWeeks.length} phases`}
      lede="The Moniepoint QA loop is the wedge: one real issue flow, deployed on client-owned Cloudflare, with approval-first writeback and a full audit trail. Each week has one exit criterion."
    >
      <ol className="roadmap-timeline mt-10 list-none">
        {pilotWeeks.map((week) => (
          <li
            key={week.id}
            id={`week-${week.id}`}
            className="roadmap-week scroll-mt-10"
            data-current={week.id === 'now' || undefined}
          >
            <span className="roadmap-week-marker" aria-hidden="true">
              {week.label}
            </span>
            <h3 className="pt-2 text-[16px] font-medium leading-6">
              <span className="sr-only">{week.label}: </span>
              {week.goal}
            </h3>
            <div className="roadmap-lanes mt-4">
              {week.lanes.map((lane) => (
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
            <p className="roadmap-done-when mt-4 text-[14px] leading-6.5">
              Done when — {week.doneWhen}
            </p>
          </li>
        ))}
      </ol>
    </Section>
  )
}

/** Both issue boards: GitHub clusters, then the workspace backlog. */
function Boards() {
  return (
    <Section
      id="boards"
      title="On the boards"
      meta={`${githubGroups.reduce((n, g) => n + g.items.length, 0)} GitHub · ${workspaceBoard.length} workspace`}
      lede="Everything open on GitHub and the workspace board, reconciled against the docs. Items already shipped on main are flagged rather than hidden — the boards should catch up to reality, not the other way around."
    >
      <div className="space-y-12">
        {githubGroups.map((group) => (
          <div key={group.title}>
            <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-[color:var(--ink)]">
              {group.title}
            </h3>
            <div className="mt-3">
              <WorkRows items={group.items} linkRefs />
            </div>
          </div>
        ))}
        <div>
          <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-[color:var(--ink)]">
            Workspace backlog
          </h3>
          <p className="mt-1 text-[13px] leading-6 text-[color:var(--slate)]">
            Curated — test fixtures and duplicates excluded.
          </p>
          <div className="mt-3">
            <WorkRows items={workspaceBoard} />
          </div>
        </div>
      </div>
    </Section>
  )
}

/** Deferrals and anti-priorities — restraint, stated as loudly as the plans. */
function NotNow() {
  return (
    <Section
      id="not-now"
      title="Deliberately not now"
      lede="Half of a roadmap is what it refuses. These are decisions, not omissions — each waits for measured evidence, and the second list is a standing no."
    >
      <div className="grid gap-10 sm:grid-cols-2">
        <div>
          <h3 className="text-[13px] font-semibold text-[color:var(--ink)]">
            Deferred until evidence
          </h3>
          <ul className="mt-3 list-none space-y-2.5">
            {deferredUntilEvidence.map((item) => (
              <li
                key={item}
                className="flex gap-2.5 text-[13.5px] leading-6 text-[color:var(--gravel)]"
              >
                <span
                  aria-hidden="true"
                  className="mt-[9px] h-px w-3 flex-shrink-0 bg-[color:var(--stone)]"
                />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-[13px] font-semibold text-[color:var(--clay-ink)]">
            Anti-priorities
          </h3>
          <ul className="mt-3 list-none space-y-2.5">
            {antiPriorities.map((item) => (
              <li
                key={item}
                className="flex gap-2.5 text-[13.5px] leading-6 text-[color:var(--gravel)]"
              >
                <span
                  aria-hidden="true"
                  className="mt-[7px] flex-shrink-0 font-mono text-[10px] leading-none text-[color:var(--clay-ink)]"
                >
                  ×
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  )
}

function Footer() {
  return (
    <footer className="mt-24 border-t border-[color:var(--hairline)] pt-6">
      <p className="text-[12px] leading-6 text-[color:var(--slate)]">
        Reconciled {roadmapMeta.updated} from{' '}
        {roadmapMeta.sources.map((s, i) => (
          <span key={s.label}>
            {i > 0 && ' · '}
            <span className="font-mono text-[11px] text-[color:var(--gravel)]">{s.label}</span>{' '}
            ({s.detail})
          </span>
        ))}
        .
      </p>
    </footer>
  )
}
