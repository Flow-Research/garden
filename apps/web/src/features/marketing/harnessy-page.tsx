import { BrandIcon } from '@garden/ui/components/common/brand-icon'
import './harnessy.css'
import { StatusBadge } from './status-badge'
import {
  adapters,
  harnessyPageCopy,
  jarvis,
  ownership,
  packaging,
  runFlow,
  stackSystems,
  whereWeAre,
  whereWeAreGoing,
  type HarnessySection,
  type StackSystem,
} from './harnessy-copy'

/** Sidebar / mobile table-of-contents entries, in document order. */
const tocEntries: { id: string; title: string }[] = [
  { id: 'stack', title: 'The stack' },
  { id: ownership.id, title: ownership.title },
  { id: runFlow.id, title: runFlow.title },
  { id: packaging.id, title: packaging.title },
  { id: adapters.id, title: adapters.title },
  { id: jarvis.id, title: jarvis.title },
  { id: whereWeAre.id, title: whereWeAre.title },
  { id: whereWeAreGoing.id, title: whereWeAreGoing.title },
]

/**
 * Architecture + direction page at /harnessy. Mirrors the /features reference
 * layout — left TOC and main content each get their own scroll pane
 * (`h-dvh overflow-y-auto`) so the TOC does not wait on main-column scroll, and
 * the root body stays overflow-hidden for the workspace shell.
 */
export function HarnessyPage() {
  return (
    <div className="harnessy-root flex h-dvh text-foreground">
      <aside className="hidden h-dvh w-56 shrink-0 overflow-y-auto border-r border-[color:var(--hairline-soft)] bg-[color:var(--parchment-deep)] lg:block">
        <div className="space-y-6 px-4 py-6">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <BrandIcon className="size-4" noSpin bordered size="sm" />
            Garden
          </div>
          <nav aria-label="Sections" className="space-y-2.5">
            {tocEntries.map((entry) => (
              <a
                key={entry.id}
                href={`#${entry.id}`}
                className="block text-xs font-medium leading-snug text-foreground hover:text-[color:var(--moss)]"
              >
                {entry.title}
              </a>
            ))}
          </nav>
        </div>
      </aside>

      <main className="h-dvh min-w-0 flex-1 overflow-y-auto overscroll-y-contain">
        <div className="mx-auto max-w-3xl px-6 py-10 lg:px-10 lg:py-12">
          <header className="mb-12">
            <p className="text-xs text-muted-foreground">
              {harnessyPageCopy.eyebrow}
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              {harnessyPageCopy.title}
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {harnessyPageCopy.lede}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <StatusBadge status="shipped" />
              <StatusBadge status="building" />
              <StatusBadge status="planned" />
              <StatusBadge status="later" />
            </div>
          </header>

          <nav
            aria-label="Jump to section"
            className="mb-12 flex gap-2 overflow-x-auto pb-1 lg:hidden"
          >
            {tocEntries.map((entry) => (
              <a
                key={entry.id}
                href={`#${entry.id}`}
                className="shrink-0 rounded-full border border-[color:var(--hairline-soft)] px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {entry.title}
              </a>
            ))}
          </nav>

          <div className="space-y-16">
            <StackSection />
            <OwnershipSection />
            <RunFlowSection />
            <PackagingSection />
            <PointsSection section={adapters} />
            <JarvisSection />
            <PointsSection section={whereWeAre} />
            <PointsSection section={whereWeAreGoing} />
          </div>

          <p className="mt-16 border-t border-[color:var(--hairline-soft)] pt-6 text-xs text-muted-foreground">
            Source: Garden’s direct Executor implementation and the independent
            Harnessy direction. Architecture and product direction only —
            commercial, legal, identity-provider, and org-structure decisions
            are tracked elsewhere.
          </p>
        </div>
      </main>
    </div>
  )
}

/** Shared section heading: title, optional status pill, and a lede. */
function SectionHeading({
  id,
  title,
  summary,
  status,
}: {
  id: string
  title: string
  summary: string
  status?: HarnessySection['status']
}) {
  return (
    <header
      id={id}
      className="mb-6 scroll-mt-6 border-b border-[color:var(--hairline-soft)] pb-4"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {status && <StatusBadge status={status} />}
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{summary}</p>
    </header>
  )
}

/** A moss-dotted point list, used by the narrative sections. */
function PointList({ points }: { points: string[] }) {
  return (
    <ul className="space-y-3">
      {points.map((point) => (
        <li
          key={point}
          className="flex gap-3 text-sm leading-6 text-foreground/90"
        >
          <span
            aria-hidden
            className="mt-2 size-1.5 shrink-0 rounded-full bg-[color:var(--moss)]"
          />
          <span>{point}</span>
        </li>
      ))}
    </ul>
  )
}

/** The layered architecture as a scan table, mirroring the /features tables. */
function StackSection() {
  return (
    <section className="space-y-0">
      <SectionHeading
        id="stack"
        title="The stack"
        summary="Garden is the product surface and control plane. Executor is its shipped connector engine; Harnessy and Jarvis are separate projects in the broader direction."
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[color:var(--hairline-soft)] text-left">
              <th className="pb-2 pr-4 font-medium text-muted-foreground">
                System
              </th>
              <th className="hidden pb-2 pr-4 font-medium text-muted-foreground sm:table-cell">
                {harnessyPageCopy.columnRole}
              </th>
              <th className="pb-2 pr-4 font-medium text-muted-foreground">
                {harnessyPageCopy.columnOpenness}
              </th>
              <th className="pb-2 font-medium text-muted-foreground">
                {harnessyPageCopy.columnStatus}
              </th>
            </tr>
          </thead>
          <tbody>
            {stackSystems.map((system) => (
              <SystemRow key={system.id} system={system} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function SystemRow({ system }: { system: StackSystem }) {
  return (
    <tr className="border-b border-[color:var(--hairline-soft)] align-top last:border-0">
      <td className="py-2.5 pr-4 font-medium">{system.name}</td>
      <td className="hidden py-2.5 pr-4 text-muted-foreground sm:table-cell">
        {system.role}
      </td>
      <td className="whitespace-nowrap py-2.5 pr-4 text-muted-foreground">
        {system.openness}
      </td>
      <td className="py-2.5">
        <StatusBadge status={system.status} />
      </td>
    </tr>
  )
}

/** Garden vs Harnessy ownership: two columns plus the boundary principle. */
function OwnershipSection() {
  return (
    <section>
      <SectionHeading
        id={ownership.id}
        title={ownership.title}
        summary={ownership.summary}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        {[ownership.harnessy, ownership.garden].map((side) => (
          <div
            key={side.owner}
            className="rounded-lg border border-[color:var(--hairline-soft)] p-5"
          >
            <h3 className="text-sm font-semibold">{side.owner}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{side.lead}</p>
            <ul className="mt-4 space-y-2.5">
              {side.items.map((item) => (
                <li
                  key={item}
                  className="flex gap-2.5 text-[13px] leading-6 text-foreground/90"
                >
                  <span
                    aria-hidden
                    className="mt-2 size-1.5 shrink-0 rounded-full bg-[color:var(--moss)]"
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <Callout label="Boundary" body={ownership.principle} />
    </section>
  )
}

/** The host-contract handoff as a numbered sequence. */
function RunFlowSection() {
  return (
    <section>
      <SectionHeading
        id={runFlow.id}
        title={runFlow.title}
        summary={runFlow.summary}
      />
      <ol className="space-y-4">
        {runFlow.steps.map((step, index) => (
          <li key={step.text} className="flex gap-4">
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-[color:var(--hairline-soft)] text-xs font-medium text-muted-foreground">
              {index + 1}
            </span>
            <div className="min-w-0 text-sm leading-6">
              <span className="font-medium text-[color:var(--moss)]">
                {step.actor}
              </span>
              <span className="text-foreground/90"> — {step.text}</span>
            </div>
          </li>
        ))}
      </ol>
      <Callout label="Rule" body={runFlow.rule} />
    </section>
  )
}

/** Packaging taxonomy table plus operating points. */
function PackagingSection() {
  return (
    <section>
      <SectionHeading
        id={packaging.id}
        title={packaging.title}
        summary={packaging.summary}
      />
      <div className="mb-6 overflow-x-auto">
        <table className="w-full min-w-[28rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[color:var(--hairline-soft)] text-left">
              <th className="pb-2 pr-4 font-medium text-muted-foreground">
                Pack family
              </th>
              <th className="pb-2 font-medium text-muted-foreground">
                Purpose
              </th>
            </tr>
          </thead>
          <tbody>
            {packaging.kinds.map((kind) => (
              <tr
                key={kind.name}
                className="border-b border-[color:var(--hairline-soft)] align-top last:border-0"
              >
                <td className="whitespace-nowrap py-2.5 pr-4 font-medium">
                  {kind.name}
                </td>
                <td className="py-2.5 text-muted-foreground">{kind.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PointList points={packaging.points} />
    </section>
  )
}

/** Jarvis: what it owns, what it leaves to the host, and the direction. */
function JarvisSection() {
  return (
    <section>
      <SectionHeading
        id={jarvis.id}
        title={jarvis.title}
        summary={jarvis.summary}
        status={jarvis.status}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="rounded-lg border border-[color:var(--hairline-soft)] p-5">
          <h3 className="text-sm font-semibold">Jarvis owns</h3>
          <ul className="mt-4 space-y-2.5">
            {jarvis.owns.map((item) => (
              <li
                key={item}
                className="flex gap-2.5 text-[13px] leading-6 text-foreground/90"
              >
                <span
                  aria-hidden
                  className="mt-2 size-1.5 shrink-0 rounded-full bg-[color:var(--moss)]"
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-[color:var(--hairline-soft)] p-5">
          <h3 className="text-sm font-semibold">The host owns (not Jarvis)</h3>
          <ul className="mt-4 space-y-2.5">
            {jarvis.notOwns.map((item) => (
              <li
                key={item}
                className="flex gap-2.5 text-[13px] leading-6 text-muted-foreground"
              >
                <span
                  aria-hidden
                  className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/40"
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <Callout label="Direction" body={jarvis.direction} />
    </section>
  )
}

/** A plain narrative section (heading + point list). */
function PointsSection({ section }: { section: HarnessySection }) {
  return (
    <section>
      <SectionHeading
        id={section.id}
        title={section.title}
        summary={section.summary}
        status={section.status}
      />
      <PointList points={section.points} />
    </section>
  )
}

/** A labelled emphasis box for a boundary rule or direction note. */
function Callout({ label, body }: { label: string; body: string }) {
  return (
    <div className="mt-6 rounded-lg border-l-2 border-[color:var(--moss)] bg-[color-mix(in_srgb,var(--moss)_8%,transparent)] px-5 py-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--moss)]">
        {label}
      </p>
      <p className="mt-1 text-sm leading-6 text-foreground/90">{body}</p>
    </div>
  )
}
