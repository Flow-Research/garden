import { Fragment, useMemo, useState } from 'react'
import { ChevronRight, Plus, Search } from 'lucide-react'
import type { Skill } from '@garden/core/types'
import { Button } from '@garden/ui/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@garden/ui/components/ui/tooltip'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@garden/ui/components/ui/input-group'
import { cn } from '@garden/ui/lib/utils'

const CATEGORY_ORDER = new Map([
  ['QA', 0],
  ['Integration', 1],
  ['Content', 2],
  ['Uncategorized', 4],
])

/** Uses catalog metadata rather than guessing a category from a skill's name. */
export function skillCategory(skill: Skill) {
  const category = skill.config.metadata?.category?.trim() || 'Uncategorized'
  return category.toLowerCase() === 'qa'
    ? 'QA'
    : category.charAt(0).toUpperCase() + category.slice(1)
}

/** Keeps search mounted and mobile rows continuous; categories label only the desktop rail. */
export function SkillsList({
  skills,
  selectedSkillId,
  onSelectSkill,
  onAdd,
  detailOpen,
}: {
  skills: Skill[]
  selectedSkillId: string
  onSelectSkill: (id: string) => void
  onAdd: () => void
  detailOpen: boolean
}) {
  const [filter, setFilter] = useState('')
  const groups = useMemo(() => {
    const grouped = new Map<string, Skill[]>()
    for (const skill of skills) {
      const label = skillCategory(skill)
      const group = grouped.get(label) ?? []
      group.push(skill)
      grouped.set(label, group)
    }
    return Array.from(grouped, ([label, items]) => ({
      label,
      items: [...items].sort((a, b) => a.name.localeCompare(b.name)),
    })).sort(
      (a, b) =>
        (CATEGORY_ORDER.get(a.label) ?? 3) -
          (CATEGORY_ORDER.get(b.label) ?? 3) || a.label.localeCompare(b.label),
    )
  }, [skills])
  const query = filter.trim().toLowerCase()
  const visibleGroups = groups.flatMap((group) => {
    const items = group.items.filter(
      (skill) =>
        skill.name.toLowerCase().includes(query) ||
        skill.description.toLowerCase().includes(query),
    )
    return items.length ? [{ ...group, items }] : []
  })

  return (
    <nav
      aria-label="Skills"
      className={cn(
        'min-h-0 min-w-0 w-full shrink-0 flex-col bg-background md:flex md:w-64 md:border-r lg:w-72',
        detailOpen ? 'hidden' : 'flex',
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-5 pb-4 md:px-4 md:pt-4">
        <div className="min-w-0 md:flex md:items-baseline md:gap-2">
          <h1 className="text-2xl font-bold tracking-tight md:text-lg">
            Skills
          </h1>
          <p className="text-xs text-muted-foreground tabular-nums">
            <span className="md:hidden">
              {skills.length} {skills.length === 1 ? 'skill' : 'skills'}
            </span>
            <span className="hidden md:inline">{skills.length}</span>
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                onClick={onAdd}
                variant="ghost"
                size="icon-lg"
                aria-label="Add skill"
                className="size-11 shrink-0 rounded-lg text-muted-foreground md:size-8"
              >
                <Plus className="size-4" />
              </Button>
            }
          />
          <TooltipContent side="bottom">Add skill</TooltipContent>
        </Tooltip>
      </div>
      <div className="shrink-0 px-4 pb-3">
        <InputGroup className="h-11 rounded-xl">
          <InputGroupAddon>
            <Search className="text-muted-foreground" />
          </InputGroupAddon>
          <InputGroupInput
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter skills"
            aria-label="Filter skills"
          />
        </InputGroup>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 md:px-3">
        {visibleGroups.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <p className="text-sm">No matches</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilter('')
              }}
            >
              Clear filter
            </Button>
          </div>
        ) : (
          <ul className="overflow-hidden rounded-2xl bg-muted/40 md:space-y-1 md:rounded-none md:bg-transparent">
            {visibleGroups.map((group) => (
              <Fragment key={group.label}>
                {group.label !== 'Uncategorized' ? (
                  <li className="hidden pt-4 pb-1 md:block">
                    <h2 className="flex items-center gap-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <span className="min-w-0 truncate">{group.label}</span>
                      <span className="hidden md:inline">·</span>
                      <span className="ml-auto md:ml-0">
                        {group.items.length}
                      </span>
                    </h2>
                  </li>
                ) : null}
                {group.items.map((skill) => {
                  const selected = selectedSkillId === skill.id
                  return (
                    // Mobile used a bottom rule on every row, so the list
                    // read as framed at the top and bottom of each skill.
                    <li key={skill.id}>
                      <button
                        type="button"
                        aria-label={skill.name}
                        aria-current={selected ? 'page' : undefined}
                        onClick={() => onSelectSkill(skill.id)}
                        className={cn(
                          'flex min-h-16 w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring md:min-h-11 md:rounded-lg md:px-3 md:py-2.5',
                          selected
                            ? 'bg-primary/15 text-primary'
                            : 'hover:bg-muted/70',
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span
                            className="block truncate font-mono text-sm font-semibold"
                            title={skill.name}
                          >
                            {skill.name}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground md:hidden">
                            {skill.description}
                          </span>
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground md:hidden" />
                      </button>
                    </li>
                  )
                })}
              </Fragment>
            ))}
          </ul>
        )}
      </div>
    </nav>
  )
}
