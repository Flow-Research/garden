import { BrandIcon } from '@garden/ui/components/common/brand-icon'
import { FeatureGroupSection } from './feature-group'
import {
  featureGroups,
  featuresPageCopy,
  gardenFeatures,
} from './feature-copy'
import { StatusBadge } from './status-badge'

/**
 * Designer-facing feature reference at /features. Left nav and main content each
 * get their own scroll pane (`h-dvh overflow-y-auto`) so the TOC does not wait
 * on main-column scroll. Root body stays overflow-hidden for the workspace shell.
 */
export function FeaturesPage() {
  const featuresByGroup = featureGroups.map((group) => ({
    group,
    features: gardenFeatures.filter((feature) => feature.group === group.id),
  }))

  return (
    <div className="flex h-dvh text-foreground">
      <aside className="hidden h-dvh w-52 shrink-0 overflow-y-auto border-r border-[color:var(--hairline-soft)] bg-[color:var(--parchment)] lg:block">
        <div className="space-y-6 px-4 py-6">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <BrandIcon className="size-4" noSpin bordered size="sm" />
            Garden
          </div>
          <nav aria-label="Feature sections" className="space-y-5">
            {featuresByGroup.map(({ group, features }) => (
              <div key={group.id}>
                <a
                  href={`#${group.id}`}
                  className="mb-1.5 block text-xs font-medium text-foreground hover:text-[color:var(--moss)]"
                >
                  {group.title}
                </a>
                <ul className="space-y-0.5 border-l border-[color:var(--hairline-soft)] pl-2.5">
                  {features.map((feature) => (
                    <li key={feature.id}>
                      <a
                        href={`#${feature.id}`}
                        className="block py-0.5 text-[13px] leading-snug text-muted-foreground hover:text-foreground"
                      >
                        {feature.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      </aside>

      <main className="h-dvh min-w-0 flex-1 overflow-y-auto overscroll-y-contain">
        <div className="mx-auto max-w-3xl px-6 py-10 lg:px-10 lg:py-12">
          <header className="mb-10">
            <p className="text-xs text-muted-foreground">
              {featuresPageCopy.eyebrow}
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              {featuresPageCopy.title}
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {featuresPageCopy.lede}
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
            className="mb-10 flex gap-2 overflow-x-auto pb-1 lg:hidden"
          >
            {featuresByGroup.map(({ group }) => (
              <a
                key={group.id}
                href={`#${group.id}`}
                className="shrink-0 rounded-full border border-[color:var(--hairline-soft)] px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {group.title}
              </a>
            ))}
          </nav>

          <div className="space-y-16">
            {featuresByGroup.map(({ group, features }) => (
              <FeatureGroupSection
                key={group.id}
                group={group}
                features={features}
              />
            ))}
          </div>

          <p className="mt-16 border-t border-[color:var(--hairline-soft)] pt-6 text-xs text-muted-foreground">
            Sources: docs/core/PRD.md, docs/garden-os/garden-os-overview.typ,
            docs/core/DEFERRED.md, docs/known-gaps/
          </p>
        </div>
      </main>
    </div>
  )
}
