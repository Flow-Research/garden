import './architecture.css'
import {
  actorModel,
  architectureCopy,
  archToc,
  buildingBlocks,
  connectors,
  contrast,
  durable,
  ecosystem,
  execution,
  prompt,
  requestPath,
  sources,
  workflowsVision,
} from './architecture-copy'
import { Section, DefList, Label } from './components/primitives'
import { Disclosure } from './components/disclosure'
import { FlowDiagram } from './components/flow-diagram'
import { PlanesDiagram } from './components/planes-diagram'
import { ActorTree } from './components/actor-tree'
import { LifecycleFlow } from './components/lifecycle-flow'
import { ContrastTable } from './components/contrast-table'

/**
 * /architecture — a plain-language walkthrough of how Garden's agent runtime is
 * built and why. Public, dark, self-contained (see architecture.css). Reads top
 * to bottom like documentation; native <details> let readers go deeper without
 * the page forcing one density on everyone. SSR-safe.
 */
export function ArchitecturePage() {
  return (
    <div className="arch-root h-dvh overflow-y-auto overscroll-y-contain text-foreground">
      <div className="mx-auto flex max-w-5xl gap-12 px-6 lg:px-10">
        <aside className="sticky top-0 hidden h-dvh w-44 shrink-0 overflow-y-auto py-14 lg:block">
          <Label>On this page</Label>
          <nav className="mt-4 space-y-1 border-l border-[color:var(--hairline)] pl-3">
            {archToc.map((item, i) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="block py-1 text-[13px] leading-snug text-muted-foreground transition-colors hover:text-foreground"
              >
                <span className="mr-2 font-mono text-[10px] text-[color:var(--moss)]">
                  {String(i + 1).padStart(2, '0')}
                </span>
                {item.label}
              </a>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 pb-28">
          <Hero />

          <Section
            id="blocks"
            index="01"
            eyebrow="Vocabulary"
            title="The building blocks"
            lede="A handful of Cloudflare pieces do all the heavy lifting. Here's what each one actually is. Open any row for where its state lives and how Garden uses it."
          >
            <div className="border-t border-[color:var(--hairline)]">
              {buildingBlocks.map((b) => (
                <Disclosure
                  key={b.id}
                  summary={
                    <div>
                      <div className="flex items-baseline gap-2.5">
                        <span className="font-mono text-[14px] text-foreground">{b.name}</span>
                        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                          {b.kind}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[14px] leading-7 text-muted-foreground">{b.what}</p>
                    </div>
                  }
                >
                  <div className="space-y-2 text-[13px] leading-6">
                    <p className="text-muted-foreground">
                      <span className="text-foreground/80">Where its state lives — </span>
                      {b.state}
                    </p>
                    <p className="text-muted-foreground">
                      <span className="text-foreground/80">In Garden — </span>
                      {b.garden}
                    </p>
                  </div>
                </Disclosure>
              ))}
            </div>
          </Section>

          <Section
            id="planes"
            index="02"
            eyebrow="The shape"
            title="How it fits together"
            lede="Three layers. A database that remembers everything, the live agents, and the machinery that runs their work and reaches outside apps."
          >
            <PlanesDiagram />
          </Section>

          <Section
            id="actors"
            index="03"
            eyebrow="Isolation"
            title="Why each agent is isolated"
            lede={actorModel.intro}
          >
            <p className="-mt-2 mb-7 max-w-2xl text-[15px] leading-7 text-muted-foreground">
              {actorModel.why}
            </p>
            <ActorTree />
          </Section>

          <Section
            id="durable"
            index="04"
            eyebrow="Resilience"
            title="Surviving crashes"
            lede={durable.intro}
          >
            <DefList
              items={durable.rules.map((r) => ({ id: r.title, term: r.title, body: r.body }))}
            />
          </Section>

          <Section
            id="lifecycle"
            index="05"
            eyebrow="Walkthrough"
            title="Following a request"
            lede="Where things travel. A live chat takes the short path; assigned work runs as a crash-proof workflow. Switch tabs to compare."
          >
            <div className="mb-8">
              <Label className="mb-3 block">A chat message, end to end</Label>
              <FlowDiagram nodes={requestPath} />
            </div>
            <LifecycleFlow />
          </Section>

          <Section
            id="loops"
            index="06"
            eyebrow="Direction"
            title="Where loops are going"
            lede={workflowsVision.intro}
          >
            <div className="max-w-2xl space-y-4 text-[15px] leading-7 text-muted-foreground">
              <p>{workflowsVision.unit}</p>
              <p>{workflowsVision.loop}</p>
            </div>

            <FlowDiagram
              className="my-8"
              nodes={[
                { label: 'wake' },
                { label: 'traverse + act', tone: 'moss' },
                { label: 'commit progress', tone: 'amber' },
                { label: 'pick next intent', tone: 'amber' },
                { label: 'sleep / next run' },
              ]}
            />

            <div className="border-t border-[color:var(--hairline)]">
              {workflowsVision.principles.map((p) => (
                <Disclosure
                  key={p.id}
                  summary={<span className="text-[14px] text-foreground">{p.title}</span>}
                >
                  <p className="max-w-2xl text-[14px] leading-7 text-muted-foreground">{p.body}</p>
                </Disclosure>
              ))}
            </div>

            <p className="mt-6 max-w-2xl border-l-2 border-[color:var(--amber)] pl-4 text-[13px] leading-6 text-muted-foreground">
              {workflowsVision.status}
            </p>
          </Section>

          <Section
            id="execution"
            index="07"
            eyebrow="Doing the work"
            title="Running code & tools"
            lede={execution.intro}
          >
            <DefList
              items={execution.lanes.map((l) => ({
                id: l.id,
                term: l.name,
                sub: l.via,
                body: l.body,
              }))}
            />
            <p className="mt-5 max-w-2xl border-l-2 border-[color:var(--amber)] pl-4 text-[13px] leading-6 text-muted-foreground">
              <span className="text-foreground/80">Worth knowing: </span>
              {execution.seam}
            </p>
          </Section>

          <Section
            id="connectors"
            index="08"
            eyebrow="Outside apps"
            title="Connectors & permissions"
            lede={connectors.intro}
          >
            <p className="mb-1 text-[14px] text-muted-foreground">{connectors.trustIntro}</p>
            <DefList
              items={connectors.trust.map((t) => ({ id: t.id, term: t.name, body: t.body }))}
            />
            <p className="mt-4 text-[13px] leading-6 text-muted-foreground">{connectors.note}</p>
          </Section>

          <Section
            id="skills"
            index="09"
            eyebrow="Context"
            title="What the agent knows"
            lede={prompt.intro}
          >
            <FlowDiagram
              className="mb-8"
              nodes={[
                ...prompt.layers.map((l, i) => ({
                  label: l.name,
                  tone: i === prompt.layers.length - 1 ? ('amber' as const) : ('default' as const),
                })),
                { label: 'cached & sent' },
              ]}
            />
            <DefList
              items={prompt.layers.map((l) => ({ id: l.id, term: l.name, body: l.body }))}
            />
          </Section>

          <Section
            id="ecosystem"
            index="10"
            eyebrow="Leverage"
            title="Standing on the AI SDK"
            lede={ecosystem.intro}
          >
            <DefList items={ecosystem.gets.map((g) => ({ id: g.id, term: g.name, body: g.body }))} />
            <p className="mt-4 font-mono text-[11px] leading-5 text-muted-foreground">
              {ecosystem.evidence}
            </p>
          </Section>

          <Section
            id="contrast"
            index="11"
            eyebrow="The argument"
            title="Why not just a script?"
            lede={contrast.intro}
          >
            <p className="mb-6 max-w-2xl text-[14px] leading-7 text-muted-foreground">
              {contrast.piIntro}
            </p>
            <ContrastTable />
            <p className="mt-6 max-w-2xl text-[15px] leading-7 text-foreground/90">
              {contrast.close}
            </p>
          </Section>

          <footer className="mt-14 border-t border-[color:var(--hairline)] pt-6">
            <Label>Sources</Label>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {sources.map((s) => (
                <li key={s} className="font-mono text-[11px] text-muted-foreground">
                  {s}
                </li>
              ))}
            </ul>
          </footer>
        </main>
      </div>
    </div>
  )
}

/** Hero — the thesis, plainly stated. */
function Hero() {
  return (
    <header className="relative py-20">
      <div className="arch-hero-glow pointer-events-none absolute inset-x-0 top-0 h-64" aria-hidden />
      <div className="relative">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {architectureCopy.eyebrow}
        </p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
          {architectureCopy.title}
        </h1>
        <p className="mt-6 max-w-2xl text-[16px] leading-7 text-muted-foreground">
          {architectureCopy.lede}
        </p>
        <p className="mt-6 max-w-2xl border-l-2 border-[color:var(--moss)] pl-4 text-[15px] leading-7 text-foreground/90">
          {architectureCopy.thesis}
        </p>
      </div>
    </header>
  )
}
