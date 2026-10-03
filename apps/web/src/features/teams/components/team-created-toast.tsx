import { Triangle } from 'lucide-react'

/**
 * Team-created success toast matching the Penpot Toast component: success
 * tertiary surface, 12px radius, 14px title, optional body. Rendered
 * top-center through sonner's per-toast position.
 */
export function TeamCreatedToast({
  title,
  body,
}: {
  title: string
  body?: string
}) {
  return (
    <div className="flex w-[268px] items-center gap-3 rounded-lg bg-background-success-tertiary px-4 py-3">
      <Triangle className="size-5 shrink-0 text-text-success-default" />
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm text-text-default">{title}</span>
        {body ? (
          <span className="truncate text-sm text-text-secondary">{body}</span>
        ) : null}
      </div>
    </div>
  )
}
