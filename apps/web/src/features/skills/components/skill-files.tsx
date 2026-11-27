import { File, Folder } from 'lucide-react'
import { cn } from '@garden/ui/lib/utils'

export const SKILL_MD = 'SKILL.md'

/** Keeps the main document first while retaining every supporting bundle path. */
export function buildFileMap(
  content: string,
  files: { path: string; content: string }[],
): Map<string, string> {
  const map = new Map([[SKILL_MD, content]])
  for (const file of files) {
    if (file.path.trim()) map.set(file.path, file.content)
  }
  return map
}

/** Replaces the desktop-only tree so bundle resources remain reachable on mobile. */
export function SkillFiles({
  paths,
  selectedPath,
  onSelect,
  className,
}: {
  paths: string[]
  selectedPath: string
  onSelect: (path: string) => void
  className?: string
}) {
  return (
    <nav
      aria-label="Skill files"
      className={cn('min-w-0 shrink-0 overflow-x-auto border-b', className)}
    >
      <div className="flex w-max min-w-full gap-1 px-4 md:px-6">
        {paths.map((path) => (
          <button
            key={path}
            type="button"
            aria-current={path === selectedPath ? 'page' : undefined}
            title={path}
            onClick={() => onSelect(path)}
            className={cn(
              'flex min-h-11 max-w-72 shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-left font-mono text-xs transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
              path === selectedPath
                ? 'border-primary font-semibold text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground',
            )}
          >
            {path.includes('/') ? (
              <Folder className="size-4 shrink-0" />
            ) : (
              <File className="size-4 shrink-0" />
            )}
            <span className="truncate">{path}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
