/**
 * Team-created success toast from design 29: a single centered line on the
 * success tertiary surface with a hairline success border and no icon.
 * Rendered top-center through sonner's per-toast position.
 */
export function TeamCreatedToast({ title }: { title: string }) {
  return (
    <div className="rounded-lg border border-border-success-tertiary bg-background-success-tertiary px-4 py-3 text-center text-sm text-text-default">
      {title}
    </div>
  )
}
