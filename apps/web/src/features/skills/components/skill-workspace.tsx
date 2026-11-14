import { useMemo, useState } from 'react'
import {
  ChevronLeft,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Result } from 'better-result'
import type { Skill, UpdateSkillRequest } from '@garden/core/types'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { Button } from '@garden/ui/components/ui/button'
import { ConfirmDialog } from '@garden/ui/components/common/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@garden/ui/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@garden/ui/components/ui/dropdown-menu'
import { Input } from '@garden/ui/components/ui/input'
import { Label } from '@garden/ui/components/ui/label'
import { Skeleton } from '@garden/ui/components/ui/skeleton'
import { cn } from '@garden/ui/lib/utils'
import { api } from '@/lib/api'
import { workspaceKeys } from '@/lib/workspace/queries'
import { FileViewer, type SkillView } from './file-viewer'
import { buildFileMap, SkillFiles, SKILL_MD } from './skill-files'
import { skillCategory } from './skills-list'

type Draft = { content: string; files: { path: string; content: string }[] }

/**
 * Loads the complete bundle before editing; list entries omit supporting files.
 * As in the previous workspace, saving only SKILL.md must preserve those files.
 * Keeping path and view above the bundle key also preserves them after a save.
 */
export function SkillWorkspace({
  skill,
  onUpdate,
  onDelete,
  onReinstall,
  onDirtyChange,
  onBack,
}: {
  skill: Skill
  onUpdate: (data: UpdateSkillRequest) => Promise<unknown>
  onDelete: () => Promise<unknown>
  onReinstall: () => Promise<unknown>
  onDirtyChange: (dirty: boolean) => void
  onBack: () => void
}) {
  const wsId = useWorkspaceId()
  const query = useQuery({
    queryKey: workspaceKeys.skill(wsId, skill.id),
    queryFn: ({ signal }) => api.getSkill(skill.id, signal),
    staleTime: Infinity,
  })
  const [selectedPath, setSelectedPath] = useState(SKILL_MD)
  const [mode, setMode] = useState<SkillView>('preview')

  if (!query.data) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex min-h-14 shrink-0 items-center gap-3 border-b px-4">
          <Button
            variant="ghost"
            className="min-h-11 text-primary md:hidden"
            onClick={onBack}
            aria-label="Back to skills"
          >
            <ChevronLeft />
            Skills
          </Button>
          <span className="min-w-0 truncate text-sm font-semibold">
            {skill.name}
          </span>
        </header>
        {query.isError ? (
          <div
            role="alert"
            className="flex flex-1 flex-col items-center justify-center gap-3 p-5 text-center text-sm text-muted-foreground"
          >
            <p>This skill's files couldn't be loaded.</p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="space-y-4 p-6">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        )}
      </div>
    )
  }

  return (
    <SkillBundleEditor
      key={`${query.data.id}:${query.data.bundle_hash ?? query.data.updated_at}`}
      skill={query.data}
      selectedPath={selectedPath}
      onSelectPath={setSelectedPath}
      mode={mode}
      onModeChange={setMode}
      onUpdate={onUpdate}
      onDelete={onDelete}
      onReinstall={onReinstall}
      onDirtyChange={onDirtyChange}
      onBack={onBack}
    />
  )
}

/** Shared segmented controls keep source inspection separate from enabling edits. */
function SkillViewSwitcher({
  mode,
  onChange,
  sourceLabel = 'Source',
  disabled = false,
  className,
}: {
  mode: SkillView
  onChange: (mode: SkillView) => void
  sourceLabel?: string
  disabled?: boolean
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label="Skill view"
      className={cn('flex rounded-xl bg-muted/60 p-1', className)}
    >
      <Button
        variant="ghost"
        disabled={disabled}
        aria-pressed={mode === 'preview'}
        onClick={() => onChange('preview')}
        className={cn(
          'min-h-9 flex-1 px-4 text-sm',
          mode === 'preview' && 'bg-muted text-foreground',
        )}
      >
        Preview
      </Button>
      <Button
        variant="ghost"
        disabled={disabled}
        aria-pressed={mode !== 'preview'}
        onClick={() => onChange('source')}
        className={cn(
          'min-h-9 flex-1 px-4 text-sm',
          mode !== 'preview' && 'bg-muted text-foreground',
          sourceLabel === SKILL_MD && 'font-mono',
        )}
      >
        {sourceLabel}
      </Button>
    </div>
  )
}

/**
 * Owns one draft and reports dirty state in edit events rather than effects.
 * Failed writes keep that draft; successful writes remount from the saved bundle.
 * This lets mobile back navigation use the same discard guard as skill switching.
 */
function SkillBundleEditor({
  skill,
  selectedPath,
  onSelectPath,
  mode,
  onModeChange,
  onUpdate,
  onDelete,
  onReinstall,
  onDirtyChange,
  onBack,
}: {
  skill: Skill
  selectedPath: string
  onSelectPath: (path: string) => void
  mode: SkillView
  onModeChange: (mode: SkillView) => void
  onUpdate: (data: UpdateSkillRequest) => Promise<unknown>
  onDelete: () => Promise<unknown>
  onReinstall: () => Promise<unknown>
  onDirtyChange: (dirty: boolean) => void
  onBack: () => void
}) {
  const [saved] = useState<Draft>(() => ({
    content: skill.content,
    files: skill.files.map((file) => ({
      path: file.path,
      content: file.content,
    })),
  }))
  const [draft, setDraft] = useState(saved)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmSync, setConfirmSync] = useState(false)
  const [showAddFile, setShowAddFile] = useState(false)
  const fileMap = useMemo(
    () => buildFileMap(draft.content, draft.files),
    [draft],
  )
  const paths = useMemo(() => Array.from(fileMap.keys()), [fileMap])
  const activePath = fileMap.has(selectedPath) ? selectedPath : SKILL_MD
  const filesChanged =
    JSON.stringify(draft.files) !== JSON.stringify(saved.files)
  const isDirty = draft.content !== saved.content || filesChanged
  const canSync = skill.source_type === 'skills.sh' && Boolean(skill.source_url)
  const hasCategory = Boolean(skill.config.metadata?.category?.trim())

  /** Computes dirty state from the next complete draft, including reverting an edit. */
  const changeDraft = (next: Draft) => {
    setDraft(next)
    onDirtyChange(
      next.content !== saved.content ||
        JSON.stringify(next.files) !== JSON.stringify(saved.files),
    )
  }

  /** Captures the mutation rejection already reported by the page without dropping edits. */
  const save = async () => {
    if (!isDirty || saving) return
    setSaving(true)
    const result = await Result.tryPromise(() =>
      onUpdate({
        ...(draft.content !== saved.content ? { content: draft.content } : {}),
        ...(filesChanged ? { files: draft.files } : {}),
      }),
    )
    result.match({ ok: () => onDirtyChange(false), err: () => {} })
    setSaving(false)
  }

  /** Uses the active resource path so editing a supporting file cannot replace SKILL.md. */
  const changeContent = (content: string) => {
    changeDraft(
      activePath === SKILL_MD
        ? { ...draft, content }
        : {
            ...draft,
            files: draft.files.map((file) =>
              file.path === activePath ? { ...file, content } : file,
            ),
          },
    )
  }

  const saveButton = (
    <Button
      onClick={() => void save()}
      disabled={!isDirty || saving}
      className="min-h-11 gap-2"
    >
      <Save className="size-4" />
      {saving ? 'Saving' : 'Save'}
    </Button>
  )

  return (
    <section
      aria-label="Skill workspace"
      onKeyDown={(event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === 's'
        ) {
          event.preventDefault()
          void save()
        }
      }}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 px-4 md:border-b md:px-6 [@media(width:768px)]:grid [@media(width:768px)]:grid-cols-[minmax(0,1fr)_auto] [@media(width:768px)]:gap-2 [@media(width:768px)]:px-3 [@media(width:768px)]:py-2">
        <Button
          variant="ghost"
          onClick={onBack}
          disabled={saving}
          aria-label="Back to skills"
          className="min-h-11 gap-1 px-0 text-primary md:hidden"
        >
          <ChevronLeft />
          Skills
        </Button>
        <p className="hidden min-w-0 flex-1 items-center gap-2 text-sm md:flex [@media(width:768px)]:col-start-1 [@media(width:768px)]:row-start-1">
          <span className="text-muted-foreground">Skills</span>
          <span className="text-muted-foreground">/</span>
          <span className="truncate font-semibold">{skill.name}</span>
        </p>
        {isDirty ? (
          <span
            role="status"
            className="shrink-0 text-xs text-muted-foreground [@media(width:768px)]:col-span-2 [@media(width:768px)]:row-start-3"
          >
            Unsaved
          </span>
        ) : null}
        <div className="hidden items-center gap-2 md:flex [@media(width:768px)]:col-span-2 [@media(width:768px)]:row-start-2 [@media(width:768px)]:min-w-0 [@media(width:768px)]:flex-wrap">
          <SkillViewSwitcher
            mode={mode}
            onChange={onModeChange}
            disabled={saving}
            className="[@media(width:768px)]:min-w-32 [@media(width:768px)]:flex-1 [@media(width:768px)]:[&_button]:px-2 [@media(width:768px)]:[&_button]:text-xs"
          />
          <Button
            onClick={() => onModeChange(mode === 'edit' ? 'preview' : 'edit')}
            disabled={saving}
            className="min-h-10 px-4 [@media(width:768px)]:px-3"
          >
            <Pencil />
            {mode === 'edit' ? 'Done' : 'Edit'}
          </Button>
          {isDirty || saving ? saveButton : null}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="size-11 shrink-0 [@media(width:768px)]:col-start-2 [@media(width:768px)]:row-start-1"
                aria-label="Skill actions"
                disabled={saving}
              >
                <MoreHorizontal />
              </Button>
            }
          />
          <DropdownMenuContent align="end" sideOffset={6}>
            <DropdownMenuItem onClick={() => setShowAddFile(true)}>
              <Plus />
              Add file
            </DropdownMenuItem>
            {activePath !== SKILL_MD ? (
              <DropdownMenuItem
                variant="destructive"
                onClick={() => {
                  changeDraft({
                    ...draft,
                    files: draft.files.filter(
                      (file) => file.path !== activePath,
                    ),
                  })
                  onSelectPath(SKILL_MD)
                }}
              >
                <Trash2 />
                Delete file
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            {canSync ? (
              <>
                <DropdownMenuItem onClick={() => setConfirmSync(true)}>
                  <RefreshCw />
                  Sync from source
                </DropdownMenuItem>
                {skill.source_url ? (
                  <DropdownMenuItem
                    render={
                      <a
                        href={skill.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Open source"
                      />
                    }
                  >
                    <ExternalLink />
                    Open source
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 />
              Delete skill
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <SkillFiles
        paths={paths}
        selectedPath={activePath}
        onSelect={onSelectPath}
        className={paths.length === 1 ? 'hidden md:block' : undefined}
      />
      <div className="min-h-0 min-w-0 flex-1">
        <FileViewer
          key={activePath}
          path={activePath}
          content={fileMap.get(activePath) ?? ''}
          mode={mode}
          onChange={changeContent}
          disabled={saving}
          intro={
            <div className="mb-6 min-w-0">
              {hasCategory ? (
                <span className="inline-flex rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
                  {skillCategory(skill)}
                </span>
              ) : null}
              <h1
                className={cn(
                  'font-mono text-xl font-bold leading-snug [overflow-wrap:anywhere] md:text-2xl',
                  hasCategory && 'mt-3',
                )}
              >
                {skill.name}
              </h1>
              {skill.description ? (
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere] md:text-base">
                  {skill.description}
                </p>
              ) : null}
              <SkillViewSwitcher
                mode={mode}
                onChange={onModeChange}
                disabled={saving}
                sourceLabel={activePath === SKILL_MD ? SKILL_MD : 'Source'}
                className="mt-5 w-full md:hidden"
              />
            </div>
          }
        />
      </div>
      <footer className="flex shrink-0 gap-2 border-t bg-background px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] md:hidden">
        {mode === 'edit' || isDirty ? (
          <>
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => onModeChange(mode === 'edit' ? 'preview' : 'edit')}
              className="min-h-12 flex-1"
            >
              {mode === 'edit' ? 'Preview' : 'Edit'}
            </Button>
            <Button
              onClick={() => void save()}
              disabled={!isDirty || saving}
              className="min-h-12 flex-1 gap-2"
            >
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              {saving ? 'Saving' : 'Save'}
            </Button>
          </>
        ) : (
          <Button
            onClick={() => onModeChange('edit')}
            className="min-h-12 w-full gap-2 rounded-xl"
          >
            <Pencil />
            Edit skill
          </Button>
        )}
      </footer>
      {showAddFile ? (
        <AddFileDialog
          paths={paths}
          onClose={() => setShowAddFile(false)}
          onAdd={(path) => {
            changeDraft({
              ...draft,
              files: [...draft.files, { path, content: '' }],
            })
            onSelectPath(path)
            onModeChange('edit')
          }}
        />
      ) : null}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        media={<Trash2 className="text-destructive" />}
        title={`Delete “${skill.name}”?`}
        description="This removes the skill from every agent in this workspace and deletes all bundle files. This cannot be undone."
        confirmLabel="Delete skill"
        pendingLabel="Deleting…"
        tone="destructive"
        onConfirm={onDelete}
      />
      <ConfirmDialog
        open={confirmSync && canSync}
        onOpenChange={setConfirmSync}
        media={<RefreshCw />}
        title="Sync from source?"
        description={
          isDirty
            ? 'You have unsaved edits. Syncing discards them and replaces the bundle with the latest version from the source.'
            : 'Replaces the bundle with the latest version from the source.'
        }
        confirmLabel="Sync"
        pendingLabel="Syncing…"
        onConfirm={onReinstall}
      />
    </section>
  )
}

/** Rejects duplicate or traversing paths before adding an editable bundle resource. */
function AddFileDialog({
  paths,
  onClose,
  onAdd,
}: {
  paths: string[]
  onClose: () => void
  onAdd: (path: string) => void
}) {
  const [path, setPath] = useState('')
  const value = path.trim().replace(/\\/g, '/')
  const duplicate = paths.includes(value)
  const valid =
    value.length > 0 &&
    !duplicate &&
    !value.startsWith('/') &&
    !value.split('/').includes('..') &&
    value.toLowerCase() !== 'skill.md'
  const add = () => {
    if (valid) {
      onAdd(value)
      onClose()
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a file</DialogTitle>
          <DialogDescription>
            Use a path relative to the skill bundle.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="skill-file-path">File path</Label>
          <Input
            id="skill-file-path"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="scripts/example.py"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                add()
              }
            }}
          />
          {duplicate ? (
            <p className="text-xs text-destructive">
              This file already exists.
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid} onClick={add}>
            Add file
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
