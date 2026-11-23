import { useState, useMemo, useDeferredValue, useRef } from 'react'
import { Search, Sparkles, ArrowLeft, Download } from 'lucide-react'
import { Command as CommandPrimitive } from 'cmdk'
import type {
  Skill,
  CreateSkillRequest,
  SkillsShSearchResult,
} from '@garden/core/types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@garden/ui/components/ui/dialog'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@garden/ui/components/ui/tooltip'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@garden/ui/components/ui/empty'
import {
  InputGroup,
  InputGroupAddon,
} from '@garden/ui/components/ui/input-group'
import { Skeleton } from '@garden/ui/components/ui/skeleton'
import { LoadError } from '@garden/ui/components/common/load-error'
import { ConfirmDialog } from '@garden/ui/components/common/confirm-dialog'
import { Button } from '@garden/ui/components/ui/button'
import { Input } from '@garden/ui/components/ui/input'
import { Label } from '@garden/ui/components/ui/label'
import { toast } from 'sonner'
import { cn } from '@garden/ui/lib/utils'
import { Spinner } from '@garden/ui/components/ui/spinner'
import { api } from '@/lib/api'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { useSkillsBrowseStore } from '@garden/app-state/skills'
import { skillListOptions, workspaceKeys } from '@/lib/workspace/queries'
import { skillsShKeys } from '../queries'

import { buildFileMap, SkillFiles, SKILL_MD } from './skill-files'
import { SkillsList } from './skills-list'
import { SkillWorkspace } from './skill-workspace'
import { Result } from 'better-result'
import { FileViewer } from './file-viewer'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NO_SKILLS: Skill[] = []
const SKILLS_SH_HOST = 'skills.sh'

function isSkillsShImportTarget(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return false

  if (URL.canParse(trimmed)) {
    return new URL(trimmed).hostname === SKILLS_SH_HOST
  }

  return (
    trimmed
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean).length >= 3
  )
}

function buildSkillsShUrl(result: SkillsShSearchResult) {
  return `https://${SKILLS_SH_HOST}/${result.source}/${result.skill_id}`
}

function formatInstallCount(installs: number) {
  if (installs >= 1_000_000) {
    return `${(installs / 1_000_000).toFixed(installs >= 10_000_000 ? 0 : 1)}m`
  }
  if (installs >= 1_000) {
    return `${(installs / 1_000).toFixed(installs >= 10_000 ? 0 : 1)}k`
  }
  return String(installs)
}

// ---------------------------------------------------------------------------
// Page root
// ---------------------------------------------------------------------------

/** Coordinates library mutations and guards navigation before a draft is discarded. */
export default function SkillsPage({
  focusedSkillId,
  onSelectSkill,
}: {
  focusedSkillId?: string
  /** Puts the selection in the URL; without it, selection is local. */
  onSelectSkill?: (skillId: string | undefined) => void
} = {}) {
  const wsId = useWorkspaceId()
  const qc = useQueryClient()
  const skillsQuery = useQuery(skillListOptions(wsId))
  const skills = skillsQuery.data ?? NO_SKILLS
  const isSkillsLoading = skillsQuery.isLoading
  const [selectedSkillId, setSelectedSkillId] = useState<string>('')
  // Switching skill remounts the editor, so unsaved edits ask first.
  const editorDirtyRef = useRef({ owner: '', dirty: false })
  const [editorRevision, setEditorRevision] = useState(0)
  const [pendingNavigation, setPendingNavigation] = useState<
    { kind: 'list' } | { kind: 'skill'; id: string } | null
  >(null)
  /** Clears a discarded draft even when desktop would still select the same first skill. */
  const openSkill = (skillId: string | undefined) => {
    if (editorDirtyRef.current.dirty)
      setEditorRevision((revision) => revision + 1)
    editorDirtyRef.current = { owner: '', dirty: false }
    setSelectedSkillId(skillId ?? '')
    onSelectSkill?.(skillId)
  }

  const browseSearch = useSkillsBrowseStore((s) => s.browseSearch)
  const setBrowseSearch = useSkillsBrowseStore((s) => s.setBrowseSearch)
  const previewUrl = useSkillsBrowseStore((s) => s.previewUrl)
  const setPreviewUrl = useSkillsBrowseStore((s) => s.setPreviewUrl)
  const resetBrowseStore = useSkillsBrowseStore((s) => s.reset)
  const addMode = useSkillsBrowseStore((s) => s.addMode)
  const setAddMode = useSkillsBrowseStore((s) => s.setAddMode)

  // Selection effective id: prefer explicit external focus, then local
  // selection, then the first skill. Keep it derived so render never calls
  // setState just to reconcile props/query data.
  const effectiveSkillId =
    focusedSkillId && skills.some((s) => s.id === focusedSkillId)
      ? focusedSkillId
      : skills.some((s) => s.id === selectedSkillId)
        ? selectedSkillId
        : (skills[0]?.id ?? '')

  // ------- mutations -------
  const createMutation = useMutation({
    mutationFn: (data: CreateSkillRequest) => api.createSkill(data),
    onSuccess: (skill) => {
      qc.setQueryData(workspaceKeys.skill(wsId, skill.id), skill)
      qc.invalidateQueries({
        queryKey: workspaceKeys.skills(wsId),
        exact: true,
      })
      openSkill(skill.id)
      toast.success('Skill created')
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to create skill')
    },
  })

  const importMutation = useMutation({
    mutationFn: (url: string) => api.importSkill({ url }),
    onSuccess: async (skill) => {
      qc.setQueryData(workspaceKeys.skill(wsId, skill.id), skill)
      await qc.invalidateQueries({
        queryKey: workspaceKeys.skills(wsId),
        exact: true,
      })
      openSkill(skill.id)
      resetBrowseStore()
      toast.success('Skill added')
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Import failed')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteSkill(id),
    onSuccess: (_, id) => {
      if (effectiveSkillId === id) openSkill(undefined)
      qc.removeQueries({ queryKey: workspaceKeys.skill(wsId, id) })
      qc.invalidateQueries({
        queryKey: workspaceKeys.skills(wsId),
        exact: true,
      })
      toast.success('Skill deleted')
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to delete skill')
    },
  })

  const reinstallMutation = useMutation({
    mutationFn: (url: string) => api.importSkill({ url }),
    onSuccess: async (skill) => {
      qc.setQueryData(workspaceKeys.skill(wsId, skill.id), skill)
      await qc.invalidateQueries({
        queryKey: workspaceKeys.skills(wsId),
        exact: true,
      })
      openSkill(skill.id)
      toast.success('Synced')
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Sync failed')
    },
  })

  const selected = skills.find((s) => s.id === effectiveSkillId) ?? null
  const editorKey = `${effectiveSkillId}:${editorRevision}`
  /** A late save from a closed editor must not clear a different skill's dirty guard. */
  const reportDirty = (dirty: boolean) => {
    if (dirty || editorDirtyRef.current.owner === editorKey) {
      editorDirtyRef.current = { owner: editorKey, dirty }
    }
  }
  const detailOpen = skills.some(
    (skill) => skill.id === (focusedSkillId || selectedSkillId),
  )

  /** Mobile return and desktop selection share one unsaved-edit decision. */
  const requestNavigation = (
    destination: NonNullable<typeof pendingNavigation>,
  ) => {
    if (
      editorDirtyRef.current.dirty &&
      (destination.kind === 'list' || destination.id !== effectiveSkillId)
    ) {
      setPendingNavigation(destination)
      return
    }
    if (destination.kind === 'skill' && destination.id === effectiveSkillId) {
      setSelectedSkillId(destination.id)
      onSelectSkill?.(destination.id)
      return
    }
    openSkill(destination.kind === 'skill' ? destination.id : undefined)
  }

  const isLoading = isSkillsLoading
  const isEmpty = !isLoading && skills.length === 0

  const addDialog =
    addMode !== null ? (
      <AddSkillDialog
        initialMode={addMode}
        browseSearch={browseSearch}
        onBrowseSearchChange={setBrowseSearch}
        onPickSkill={(url) => {
          setPreviewUrl(url)
          setAddMode(null)
        }}
        onClose={() => setAddMode(null)}
        onCreate={(data) =>
          createMutation.mutateAsync(data).then(() => setAddMode(null))
        }
      />
    ) : null

  // Preview takes over the page when a skill is selected from the browser.
  if (previewUrl) {
    return (
      <SkillPreviewPage
        url={previewUrl}
        onBack={() => {
          setPreviewUrl(null)
          setAddMode('browse')
        }}
        onImport={(url) => importMutation.mutateAsync(url)}
        isImporting={importMutation.isPending}
      />
    )
  }

  if (isLoading) {
    return (
      <>
        <SkillsPageSkeleton />
        {addDialog}
      </>
    )
  }

  if (skillsQuery.isError && skills.length === 0) {
    return (
      <>
        <div className="flex flex-1 min-h-0 items-center justify-center p-8">
          <LoadError
            message="Could not load skills."
            onRetry={() => void skillsQuery.refetch()}
            retrying={skillsQuery.isFetching}
          />
        </div>
        {addDialog}
      </>
    )
  }

  if (isEmpty) {
    return (
      <>
        <div className="flex flex-1 min-h-0 items-center justify-center p-8">
          <LibraryEmptyState
            onBrowse={() => setAddMode('browse')}
            onAuthor={() => setAddMode('author')}
          />
        </div>
        {addDialog}
      </>
    )
  }

  return (
    <>
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <SkillsList
          skills={skills}
          selectedSkillId={effectiveSkillId}
          onSelectSkill={(id) => requestNavigation({ kind: 'skill', id })}
          onAdd={() => setAddMode('browse')}
          detailOpen={detailOpen}
        />
        <div
          className={cn(
            'min-h-0 min-w-0 flex-1 flex-col md:flex',
            detailOpen ? 'flex' : 'hidden',
          )}
        >
          {selected ? (
            <SkillWorkspace
              key={editorKey}
              skill={selected}
              onDelete={() => deleteMutation.mutateAsync(selected.id)}
              onReinstall={() =>
                selected.source_url
                  ? reinstallMutation.mutateAsync(selected.source_url)
                  : Promise.resolve()
              }
              onDirtyChange={reportDirty}
              onBack={() => requestNavigation({ kind: 'list' })}
            />
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={pendingNavigation !== null}
        onOpenChange={(open) => {
          if (!open) setPendingNavigation(null)
        }}
        title="Discard unsaved changes?"
        description={`Your edits to ${selected?.name ?? 'this skill'} have not been saved.`}
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        tone="destructive"
        onConfirm={() => {
          if (pendingNavigation)
            openSkill(
              pendingNavigation.kind === 'skill'
                ? pendingNavigation.id
                : undefined,
            )
          return Promise.resolve()
        }}
      />

      {addDialog}
    </>
  )
}

// ---------------------------------------------------------------------------
// Add / import dialog
// ---------------------------------------------------------------------------

type AddMode = 'browse' | 'author'

function AddSkillDialog({
  initialMode = 'browse',
  browseSearch,
  onBrowseSearchChange,
  onPickSkill,
  onClose,
  onCreate,
}: {
  initialMode?: AddMode
  browseSearch: string
  onBrowseSearchChange: (value: string) => void
  onPickSkill: (url: string) => void
  onClose: () => void
  onCreate: (data: CreateSkillRequest) => Promise<unknown>
}) {
  const [mode, setMode] = useState<AddMode>(initialMode)

  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
    >
      <DialogContent
        className={cn(
          'max-h-[calc(100dvh-2rem)] overflow-y-auto p-0',
          mode === 'browse' ? 'sm:max-w-2xl' : 'sm:max-w-xl',
        )}
      >
        {mode === 'browse' ? (
          <BrowseSearchScreen
            search={browseSearch}
            onSearchChange={onBrowseSearchChange}
            onPickSkill={onPickSkill}
            onClose={onClose}
            onSwitchToAuthor={() => setMode('author')}
          />
        ) : (
          <AuthorSkillPanel
            onClose={onClose}
            onCreate={onCreate}
            onSwitchToBrowse={() => setMode('browse')}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function BrowseSearchScreen({
  search,
  onSearchChange,
  onPickSkill,
  onClose,
  onSwitchToAuthor,
}: {
  search: string
  onSearchChange: (value: string) => void
  onPickSkill: (url: string) => void
  onClose: () => void
  onSwitchToAuthor: () => void
}) {
  const deferred = useDeferredValue(search.trim())
  const directTarget = isSkillsShImportTarget(search) ? search.trim() : ''
  const searchQuery = directTarget ? '' : deferred

  const searchResults = useQuery({
    queryKey: skillsShKeys.search(searchQuery),
    queryFn: ({ signal }) => api.searchSkills(searchQuery, 10, signal),
    enabled: searchQuery.length >= 2,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  })

  const results = searchResults.data ?? []
  const isFetching = searchResults.isFetching

  return (
    <div className="flex flex-col">
      <DialogHeader className="shrink-0 px-5 pt-5">
        <DialogTitle className="text-base font-semibold">
          Add a skill
        </DialogTitle>
        <DialogDescription className="text-xs">
          Search or paste a{' '}
          <a
            href="https://skills.sh"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 transition-colors hover:text-foreground"
          >
            skills.sh
          </a>{' '}
          reference like{' '}
          <code className="font-mono text-[11px]">owner/repo/skill</code>.
        </DialogDescription>
      </DialogHeader>

      <CommandPrimitive shouldFilter={false} className="flex flex-col">
        <div className="shrink-0 px-5 pt-4">
          <InputGroup>
            <InputGroupAddon>
              <Search className="text-muted-foreground" />
            </InputGroupAddon>
            <CommandPrimitive.Input
              value={search}
              onValueChange={onSearchChange}
              placeholder="Search skills"
              data-slot="input-group-control"
              className="flex h-8 w-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 text-sm outline-none placeholder:text-muted-foreground"
            />
            {isFetching ? (
              <InputGroupAddon align="inline-end">
                <Spinner className="size-3.5 text-muted-foreground" />
              </InputGroupAddon>
            ) : null}
          </InputGroup>
        </div>

        <div className="mt-3 h-[min(380px,45dvh)] shrink-0 overflow-y-auto border-t border-border/60 px-2 py-2">
          <CommandPrimitive.List>
            {directTarget ? (
              <CommandPrimitive.Group>
                <CommandResultItem
                  value={directTarget}
                  title={directTarget.replace(/^https?:\/\//, '')}
                  meta="Direct import"
                  onSelect={() => onPickSkill(directTarget)}
                />
              </CommandPrimitive.Group>
            ) : null}

            {searchQuery.length < 2 && !directTarget ? (
              <div className="flex h-full flex-col items-center justify-center gap-1 px-6 py-12 text-center">
                <p className="text-sm text-foreground">Search to find skills</p>
                <p className="text-xs text-muted-foreground">
                  Try &ldquo;code review&rdquo;, &ldquo;bug triage&rdquo;, or
                  &ldquo;changelog&rdquo;.
                </p>
              </div>
            ) : null}

            {searchQuery.length >= 2 && isFetching && results.length === 0 ? (
              <CommandSearchSkeleton />
            ) : null}

            {searchQuery.length >= 2 && !isFetching && results.length === 0 ? (
              <CommandPrimitive.Empty className="flex h-full flex-col items-center justify-center gap-1 px-6 py-12 text-center">
                <p className="text-sm text-foreground">No results</p>
                <p className="text-xs text-muted-foreground">
                  No skills match &ldquo;{searchQuery}&rdquo;.
                </p>
              </CommandPrimitive.Empty>
            ) : null}

            {results.length > 0 ? (
              <CommandPrimitive.Group>
                {results.map((skill) => {
                  const url = buildSkillsShUrl(skill)
                  return (
                    <CommandResultItem
                      key={skill.id}
                      value={url}
                      title={skill.name}
                      meta={skill.source}
                      trailing={`${formatInstallCount(skill.installs)} installs`}
                      onSelect={() => onPickSkill(url)}
                    />
                  )
                })}
              </CommandPrimitive.Group>
            ) : null}
          </CommandPrimitive.List>
        </div>
      </CommandPrimitive>

      <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-4 pb-5">
        <button
          type="button"
          onClick={onSwitchToAuthor}
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Create yours
        </button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function SkillPreviewPage({
  url,
  onBack,
  onImport,
  isImporting,
}: {
  url: string
  onBack: () => void
  onImport: (url: string) => Promise<unknown>
  isImporting: boolean
}) {
  const [selectedPath, setSelectedPath] = useState<string>(SKILL_MD)

  const preview = useQuery({
    queryKey: skillsShKeys.preview(url),
    queryFn: ({ signal }) => api.previewSkill(url, signal),
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  })

  const data = preview.data ?? null
  const fileMap = useMemo(
    () => (data ? buildFileMap(data.content, data.files) : new Map()),
    [data],
  )
  const filePaths = useMemo(() => Array.from(fileMap.keys()), [fileMap])
  const selectedContent = fileMap.get(selectedPath) ?? ''

  const handleImport = () => {
    if (isImporting) return
    // The import mutation toasts its own failure.
    void Result.tryPromise(() => onImport(url))
  }

  const headerTitle = data?.name ?? 'Loading skill…'

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                onClick={onBack}
                disabled={isImporting}
                className="gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="size-3.5" />
                Back
              </Button>
            }
          />
          <TooltipContent side="bottom">Return to search</TooltipContent>
        </Tooltip>
        <div className="h-4 w-px bg-border/70" />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {headerTitle}
        </p>
        <Button
          size="sm"
          onClick={handleImport}
          disabled={!data || isImporting}
          className="gap-1.5"
        >
          {isImporting ? (
            <Spinner className="size-3.5" aria-hidden="true" />
          ) : (
            <Download className="size-3.5" />
          )}
          {isImporting ? 'Adding' : 'Add skill'}
        </Button>
      </div>

      {/* Body */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {preview.isPending ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            Fetching bundle…
          </div>
        ) : preview.isError || !data ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
            <p className="text-sm font-medium text-foreground">
              Couldn&apos;t load preview
            </p>
            <p className="max-w-sm text-xs text-muted-foreground">
              {preview.error instanceof Error
                ? preview.error.message
                : 'The source returned an error while fetching this bundle.'}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void preview.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : (
          <>
            <SkillFiles
              paths={filePaths}
              selectedPath={selectedPath}
              onSelect={setSelectedPath}
            />
            <div className="min-h-0 min-w-0 flex-1">
              <FileViewer
                key={selectedPath}
                path={selectedPath}
                content={selectedContent}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function CommandResultItem({
  value,
  title,
  meta,
  trailing,
  onSelect,
}: {
  value: string
  title: string
  meta?: string
  trailing?: string
  onSelect: () => void
}) {
  return (
    <CommandPrimitive.Item
      value={value}
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm outline-none transition-colors',
        'hover:bg-muted/40 data-selected:bg-muted/40',
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate font-medium text-foreground">{title}</span>
        {meta ? (
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {meta}
          </span>
        ) : null}
      </span>
      {trailing ? (
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {trailing}
        </span>
      ) : null}
    </CommandPrimitive.Item>
  )
}

function CommandSearchSkeleton() {
  const widths = ['55%', '72%', '48%', '68%', '60%', '78%']
  return (
    <div
      className="space-y-1 px-2 pt-3"
      aria-busy="true"
      aria-label="Searching skills"
    >
      <div className="px-0.5 pb-1">
        <Skeleton className="h-2.5 w-16" />
      </div>
      {widths.map((width, idx) => (
        <div
          key={idx}
          className="flex items-center gap-3 rounded-md px-2.5 py-2"
        >
          <Skeleton className="h-3.5 flex-1" style={{ maxWidth: width }} />
          <Skeleton className="h-3 w-16 shrink-0" />
        </div>
      ))}
    </div>
  )
}

function AuthorSkillPanel({
  onClose,
  onCreate,
  onSwitchToBrowse,
}: {
  onClose: () => void
  onCreate: (data: CreateSkillRequest) => Promise<unknown>
  onSwitchToBrowse: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)

  /** The create mutation reports failures; keep form inputs available for a retry. */
  const handleSubmit = async () => {
    if (!name.trim() || !description.trim() || submitting) return
    setSubmitting(true)
    await Result.tryPromise(() =>
      onCreate({
        name: name.trim(),
        description: description.trim(),
      }),
    )
    setSubmitting(false)
  }

  return (
    <div className="flex flex-col">
      <DialogHeader className="px-5 pt-5">
        <DialogTitle className="text-base font-semibold">
          Create a skill
        </DialogTitle>
        <DialogDescription className="text-xs">
          Give it a name and a short description of what it does.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 px-5 py-4">
        <div className="space-y-1.5">
          <Label htmlFor="skill-name" className="text-xs">
            Name
          </Label>
          <Input
            id="skill-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Code Review"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void handleSubmit()
              }
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="skill-description" className="text-xs">
            Description
          </Label>
          <Input
            id="skill-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What this skill does"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void handleSubmit()
              }
            }}
          />
        </div>
      </div>

      <div className="flex flex-col-reverse items-stretch gap-3 px-5 pt-4 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={onSwitchToBrowse}
          className="self-start text-xs text-muted-foreground transition-colors hover:text-foreground sm:self-auto"
        >
          Browse skills
        </button>
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!name.trim() || !description.trim() || submitting}
          >
            {submitting ? 'Creating' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function LibraryEmptyState({
  onBrowse,
  onAuthor,
}: {
  onBrowse: () => void
  onAuthor: () => void
}) {
  return (
    <Empty className="max-w-sm border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Sparkles />
        </EmptyMedia>
        <EmptyTitle>Your skill library is empty</EmptyTitle>
        <EmptyDescription>
          Skills teach agents how to handle specific tasks. Browse community
          skills or author your own.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button size="sm" onClick={onBrowse}>
            Browse skills
          </Button>
          <Button size="sm" variant="outline" onClick={onAuthor}>
            Create yours
          </Button>
        </div>
      </EmptyContent>
    </Empty>
  )
}

// ---------------------------------------------------------------------------
// Loading skeletons
// ---------------------------------------------------------------------------

function SkillsPageSkeleton() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="flex w-full flex-col md:w-64 md:shrink-0 md:border-r lg:w-72">
        <div className="flex h-12 shrink-0 items-center justify-between border-b px-3">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="size-7 rounded-md" />
        </div>
        <div className="shrink-0 border-b px-3 py-2">
          <Skeleton className="h-8 w-full rounded-lg" />
        </div>
        <div className="flex-1 space-y-1 px-1.5 py-2">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2 rounded-md px-2 py-2"
            >
              <Skeleton className="size-3 rounded-sm" />
              <Skeleton
                className="h-3"
                style={{ width: `${45 + ((idx * 11) % 35)}%` }}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="hidden min-w-0 flex-1 flex-col md:flex">
        <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
          <Skeleton className="h-4 w-1/3" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-6 w-14 rounded-md" />
            <Skeleton className="size-7 rounded-md" />
          </div>
        </div>
        <div className="flex-1">
          <FileViewerSkeleton />
        </div>
      </div>
    </div>
  )
}

function FileViewerSkeleton() {
  return (
    <div className="space-y-4 p-6">
      <Skeleton className="h-5 w-2/5" />
      <Skeleton className="h-3 w-4/5" />
      <Skeleton className="h-3 w-3/4" />
      <div className="space-y-2 pt-2">
        <Skeleton className="h-3 w-1/4" />
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  )
}
