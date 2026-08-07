import type { GardenFeature } from './feature-copy'
import { featuresPageCopy } from './feature-copy'
import { StatusBadge, UpdatedBadge } from './status-badge'

/**
 * Full detail for one feature — single-column so designers can read top to bottom.
 */
export function FeatureSection({ feature }: { feature: GardenFeature }) {
  return (
    <article
      id={feature.id}
      className="scroll-mt-6 border-t border-[color:var(--hairline-soft)] py-8"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="text-base font-semibold">{feature.name}</h3>
        <StatusBadge status={feature.status} />
        {feature.updated && <UpdatedBadge />}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{feature.tagline}</p>

      <dl className="mt-5 max-w-3xl space-y-5">
        <FeatureField label={featuresPageCopy.columnWhy} body={feature.why} />
        <FeatureField
          label={featuresPageCopy.columnHelps}
          body={feature.helps}
        />
        <FeatureField
          label={featuresPageCopy.columnTriggered}
          body={feature.triggered}
        />
      </dl>
    </article>
  )
}

function FeatureField({ label, body }: { label: string; body: string }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[9rem_1fr] sm:gap-6">
      <dt className="text-xs font-medium text-muted-foreground sm:pt-0.5">
        {label}
      </dt>
      <dd className="text-sm leading-6 text-foreground/90">{body}</dd>
    </div>
  )
}
