import { actorModel } from '../architecture-copy'

/**
 * Actor tree: one AgentDO parent connecting down to three Think facet children,
 * each keyed independently with its own SQLite scope. Pure CSS/flex layout with
 * a connector rail — no graph library.
 */
export function ActorTree() {
  return (
    <div className="arch-card p-6">
      {/* Parent */}
      <div className="mx-auto max-w-md rounded-lg border border-success/40 bg-muted p-4 text-center">
        <div className="font-mono text-sm font-semibold text-success">
          {actorModel.parent.name}
        </div>
        <div className="mt-1 text-[12px] leading-5 text-muted-foreground">
          {actorModel.parent.sub}
        </div>
      </div>

      {/* Connectors */}
      <div className="relative mx-auto h-8 w-px bg-border" aria-hidden />
      <div
        className="mx-auto mb-3 hidden h-px max-w-3xl bg-border sm:block"
        aria-hidden
      />

      {/* Facet children */}
      <div className="grid gap-3 sm:grid-cols-3">
        {actorModel.facets.map((facet) => (
          <div
            key={facet.id}
            className="rounded-lg border border-border bg-card p-4"
          >
            <div className="font-mono text-[13px] font-medium text-foreground">
              {facet.name}
            </div>
            <div className="mt-0.5 font-mono text-[11px] text-text-warning-tertiary">
              {facet.key}
            </div>
            <p className="mt-2 text-[12px] leading-5 text-muted-foreground">
              {facet.sub}
            </p>
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              <span className="size-1.5 rounded-full bg-success" /> private
              sqlite
            </div>
          </div>
        ))}
      </div>

      <p className="mt-5 border-t border-border pt-4 text-[12px] leading-6 text-muted-foreground">
        {actorModel.note}
      </p>
    </div>
  )
}
