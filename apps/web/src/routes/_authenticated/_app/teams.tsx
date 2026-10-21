import { createFileRoute } from '@tanstack/react-router'
import { Users } from 'lucide-react'

export const Route = createFileRoute('/_authenticated/_app/teams')({
  component: TeamsRoute,
})

/**
 * Teams surface — new in the redesign (expandable sidebar section in the
 * Penpot file). Placeholder for the route + nav position until its design
 * reaches DEV READY and the surface gets its own pass.
 */
function TeamsRoute() {
  return (
    <section className="flex h-full flex-1 items-center justify-center px-6">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <span className="flex size-10 items-center justify-center rounded-md bg-background-main-secondary">
          <Users className="size-5 text-icon-neutral-tertiary" />
        </span>
        <h1 className="text-sm font-medium text-text-neutral-default">Teams</h1>
        <p className="text-sm text-text-secondary">
          Team spaces land here in the redesign pass. Workspace members live in
          Settings for now.
        </p>
      </div>
    </section>
  )
}
