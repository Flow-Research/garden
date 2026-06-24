import type { FeatureGroup, GardenFeature } from './feature-copy'
import { FeatureSection } from './feature-section'
import { StatusBadge, UpdatedBadge } from './status-badge'

/**
 * One product group on /features: scan table at top, then full detail per feature.
 */
export function FeatureGroupSection({
  group,
  features,
}: {
  group: FeatureGroup
  features: GardenFeature[]
}) {
  if (features.length === 0) return null

  return (
    <section id={group.id} className="scroll-mt-6">
      <header className="mb-6 border-b border-[color:var(--hairline-soft)] pb-4">
        <h2 className="text-lg font-semibold tracking-tight">{group.title}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {group.description}
        </p>
      </header>

      <div className="mb-8 overflow-x-auto">
        <table className="w-full min-w-[28rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[color:var(--hairline-soft)] text-left">
              <th className="pb-2 pr-4 font-medium text-muted-foreground">
                Feature
              </th>
              <th className="pb-2 pr-4 font-medium text-muted-foreground">
                Status
              </th>
              <th className="hidden pb-2 font-medium text-muted-foreground sm:table-cell">
                Summary
              </th>
            </tr>
          </thead>
          <tbody>
            {features.map((feature) => (
              <tr
                key={feature.id}
                className="border-b border-[color:var(--hairline-soft)] last:border-0"
              >
                <td className="py-2.5 pr-4 font-medium">
                  <a
                    href={`#${feature.id}`}
                    className="hover:text-[color:var(--moss)] hover:underline"
                  >
                    {feature.name}
                  </a>
                </td>
                <td className="py-2.5 pr-4">
                  <span className="inline-flex items-center gap-1.5">
                    <StatusBadge status={feature.status} />
                    {feature.updated && <UpdatedBadge />}
                  </span>
                </td>
                <td className="hidden py-2.5 text-muted-foreground sm:table-cell">
                  {feature.tagline}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-0">
        {features.map((feature) => (
          <FeatureSection key={feature.id} feature={feature} />
        ))}
      </div>
    </section>
  )
}
