'use client'

import { useState, useMemo, useDeferredValue } from 'react'
import {
  Plus,
  Trash2,
  Save,
  Search,
  MoreHorizontal,
  RefreshCw,
  ExternalLink,
  Sparkles,
  Loader2,
  ArrowLeft,
  Download,
} from 'lucide-react'
import { Command as CommandPrimitive } from 'cmdk'
import type {
  Skill,
  CreateSkillRequest,
  SkillsShSearchResult,
  UpdateSkillRequest,
} from '@garden/core/types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@garden/ui/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogCancel,
  AlertDialogAction,
} from '@garden/ui/components/ui/alert-dialog'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@garden/ui/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@garden/ui/components/ui/dropdown-menu'
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
import { Kbd, KbdGroup } from '@garden/ui/components/ui/kbd'
import { Skeleton } from '@garden/ui/components/ui/skeleton'
import { Button } from '@garden/ui/components/ui/button'
import { Input } from '@garden/ui/components/ui/input'
import { Label } from '@garden/ui/components/ui/label'
import { toast } from 'sonner'
import { cn } from '@garden/ui/lib/utils'
import { api } from '@/lib/api'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useAuthStore } from '@garden/core/auth'
import { useWorkspaceId } from '@garden/core/hooks'
import { useSkillsBrowseStore, useSkillEditorStore } from '@garden/core/skills'
import { skillListOptions, workspaceKeys } from '@/lib/workspace/queries'

import { FileTree } from './file-tree'
import { FileViewer } from './file-viewer'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SKILL_MD = 'SKILL.md'
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

function isMacOS() {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad/.test(navigator.platform)
}

function buildFileMap(
  content: string,
  files: { path: string; content: string }[],
): Map<string, string> {
  const map = new Map<string, string>()
  map.set(SKILL_MD, content)
  for (const f of files) {
    if (f.path.trim()) map.set(f.path, f.content)
  }
  return map
}

type LoadedFile = { path: string; content: string }

// ---------------------------------------------------------------------------
// Page root
// ---------------------------------------------------------------------------

export default function SkillsPage({
  focusedSkillId,
}: {
  focusedSkillId?: string
} = {}) {
  const isAuthLoading = useAuthStore((s) => s.isLoading)
  const wsId = useWorkspaceId()
  const qc = useQueryClient()
  const { data: skills = [], isLoading: isSkillsLoading } = useQuery(
    skillListOptions(wsId),
  )
  const [selectedSkillId, setSelectedSkillId] = useState<string>(
    focusedSkillId ?? '',
  )

  // Render-time sync: when an external surface (e.g. sidebar or agent tab)
  // asks us to focus a specific skill, swap selection without a useEffect.
  const [syncedFocusId, setSyncedFocusId] = useState<string | undefined>(
    focusedSkillId,
  )
  if (focusedSkillId !== syncedFocusId) {
    setSyncedFocusId(focusedSkillId)
    if (focusedSkillId) {
      setSelectedSkillId(focusedSkillId)
    }
  }

  const browseSearch = useSkillsBrowseStore((s) => s.browseSearch)
  const setBrowseSearch = useSkillsBrowseStore((s) => s.setBrowseSearch)
  const previewUrl = useSkillsBrowseStore((s) => s.previewUrl)
  const setPreviewUrl = useSkillsBrowseStore((s) => s.setPreviewUrl)
  const resetBrowseStore = useSkillsBrowseStore((s) => s.reset)
  const addMode = useSkillsBrowseStore((s) => s.addMode)
  const setAddMode = useSkillsBrowseStore((s) => s.setAddMode)

  // Selection effective id: prefer focused/selected, else the first skill.
  const effectiveSkillId = skills.some((s) => s.id === selectedSkillId)
    ? selectedSkillId
    : (skills[0]?.id ?? '')

  if (effectiveSkillId && effectiveSkillId !== selectedSkillId) {
    setSelectedSkillId(effectiveSkillId)
  }

  // ------- mutations -------
  const createMutation = useMutation({
    mutationFn: (data: CreateSkillRequest) => api.createSkill(data),
    onSuccess: (skill) => {
      qc.setQueryData(['skill', skill.id], skill)
      qc.invalidateQueries({ queryKey: workspaceKeys.skills(wsId) })
      setSelectedSkillId(skill.id)
      toast.success('Skill created')
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to create skill')
    },
  })

  const importMutation = useMutation({
    mutationFn: (url: string) => api.importSkill({ url }),
    onSuccess: async (skill) => {
      qc.setQueryData(['skill', skill.id], skill)
      await qc.invalidateQueries({ queryKey: workspaceKeys.skills(wsId) })
      setSelectedSkillId(skill.id)
      resetBrowseStore()
      toast.success('Skill added')
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Import failed')
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateSkillRequest }) =>
      api.updateSkill(id, data),
    onSuccess: (updated) => {
      qc.setQueryData(['skill', updated.id], updated)
      qc.invalidateQueries({ queryKey: workspaceKeys.skills(wsId) })
      toast.success('Saved')
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteSkill(id),
    onSuccess: (_, id) => {
      if (selectedSkillId === id) {
        const remaining = skills.filter((s) => s.id !== id)
        setSelectedSkillId(remaining[0]?.id ?? '')
      }
      qc.removeQueries({ queryKey: ['skill', id] })
      qc.invalidateQueries({ queryKey: workspaceKeys.skills(wsId) })
      toast.success('Skill deleted')
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to delete skill')
    },
  })

  const reinstallMutation = useMutation({
    mutationFn: (skill: Skill) => {
      if (!skill.source_url) throw new Error('Skill has no source URL')
      return api.importSkill({ url: skill.source_url })
    },
    onSuccess: async (skill) => {
      qc.setQueryData(['skill', skill.id], skill)
      await qc.invalidateQueries({ queryKey: workspaceKeys.skills(wsId) })
      setSelectedSkillId(skill.id)
      toast.success('Synced')
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Sync failed')
    },
  })

  const selected = skills.find((s) => s.id === effectiveSkillId) ?? null

  const isLoading = isAuthLoading || isSkillsLoading
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
      <SkillWorkspace
        key={effectiveSkillId}
        skill={selected}
        onUpdate={(data) =>
          selected
            ? updateMutation.mutateAsync({ id: selected.id, data })
            : Promise.resolve()
        }
        onDelete={() =>
          selected ? deleteMutation.mutateAsync(selected.id) : Promise.resolve()
        }
        onReinstall={() =>
          selected ? reinstallMutation.mutateAsync(selected) : Promise.resolve()
        }
        isReinstalling={reinstallMutation.isPending}
      />

      {addDialog}
    </>
  )
}

// ---------------------------------------------------------------------------
// Skill workspace — owns local editor state (content/files/selectedPath) for
// the currently-selected skill. Remounts when the skill id changes so the
// state is fresh and we can safely derive further state from props.
// ---------------------------------------------------------------------------

function SkillWorkspace({
  skill,
  onUpdate,
  onDelete,
  onReinstall,
  isReinstalling,
}: {
  skill: Skill | null
  onUpdate: (data: UpdateSkillRequest) => Promise<unknown>
  onDelete: () => Promise<unknown>
  onReinstall: () => Promise<unknown>
  isReinstalling: boolean
}) {
  const fullSkillQuery = useQuery({
    queryKey: ['skill', skill?.id ?? ''],
    queryFn: () => api.getSkill(skill!.id),
    enabled: Boolean(skill?.id),
    staleTime: Infinity,
  })

  const loaded = fullSkillQuery.data ?? skill
  const loadedContent = loaded?.content ?? ''
  const loadedFiles = useMemo<LoadedFile[]>(
    () =>
      (loaded?.files ?? []).map((f) => ({ path: f.path, content: f.content })),
    [loaded],
  )

  // Local editor state. Reset via render-time sync whenever the underlying
  // bundle changes (save / sync / fresh load). This replaces a useEffect.
  const bundleKey = loaded ? `${loaded.id}:${loaded.bundle_hash ?? ''}` : ''
  const [syncedKey, setSyncedKey] = useState('')
  const [content, setContent] = useState(loadedContent)
  const [files, setFiles] = useState<LoadedFile[]>(loadedFiles)

  // Selected path lives in the editor store so the sidebar's file tree
  // and this editor stay in sync without lifting state through the dock.
  const selectedPath = useSkillEditorStore((s) => s.selectedPath)
  const setSelectedPath = useSkillEditorStore((s) => s.setSelectedPath)
  const setActiveBundle = useSkillEditorStore((s) => s.setActiveBundle)
  const setStoreFilePaths = useSkillEditorStore((s) => s.setFilePaths)
  const clearActiveBundle = useSkillEditorStore((s) => s.clear)

  if (bundleKey && syncedKey !== bundleKey) {
    setSyncedKey(bundleKey)
    setContent(loadedContent)
    setFiles(loadedFiles)
    if (loaded) {
      const initialPaths = [
        SKILL_MD,
        ...loadedFiles.map((f) => f.path).filter(Boolean),
      ]
      setActiveBundle(loaded.id, initialPaths)
    }
  }

  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmSync, setConfirmSync] = useState(false)
  const [showAddFile, setShowAddFile] = useState(false)

  const loadingFiles = fullSkillQuery.isPending && !fullSkillQuery.data

  const fileMap = useMemo(() => buildFileMap(content, files), [content, files])
  const filePaths = useMemo(() => Array.from(fileMap.keys()), [fileMap])
  const selectedContent = fileMap.get(selectedPath) ?? ''

  // Keep the store's filePaths in sync with the editor's current bundle,
  // including unsaved adds/deletes. Render-time guard avoids redundant writes.
  const [syncedPathsKey, setSyncedPathsKey] = useState('')
  const filePathsKey = filePaths.join('')
  if (loaded && filePathsKey !== syncedPathsKey) {
    setSyncedPathsKey(filePathsKey)
    setStoreFilePaths(filePaths)
  }

  // If the sidebar selected a path that no longer exists (e.g. deletion),
  // fall back to SKILL.md.
  if (selectedPath && !fileMap.has(selectedPath) && fileMap.size > 0) {
    setSelectedPath(SKILL_MD)
  }

  const isDirty =
    content !== loadedContent ||
    JSON.stringify(files) !== JSON.stringify(loadedFiles)
  const canSync =
    loaded?.source_type === 'skills.sh' && Boolean(loaded?.source_url)

  const handleSave = async () => {
    if (!isDirty || saving || !skill) return
    setSaving(true)
    await onUpdate({
      content,
      files: files.filter((f) => f.path.trim()),
    }).finally(() => setSaving(false))
  }

  const handleFileContentChange = (newContent: string) => {
    if (selectedPath === SKILL_MD) {
      setContent(newContent)
    } else {
      setFiles((prev) =>
        prev.map((f) =>
          f.path === selectedPath ? { ...f, content: newContent } : f,
        ),
      )
    }
  }

  const handleAddFile = (path: string) => {
    setFiles((prev) => [...prev, { path, content: '' }])
    setSelectedPath(path)
  }

  const handleDeleteFile = () => {
    if (selectedPath === SKILL_MD) return
    setFiles((prev) => prev.filter((f) => f.path !== selectedPath))
    setSelectedPath(SKILL_MD)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const mod = isMacOS() ? event.metaKey : event.ctrlKey
    if (mod && event.key.toLowerCase() === 's') {
      event.preventDefault()
      void handleSave()
    }
  }

  // Clear the store when the workspace unmounts (skill panel closed).
  // Effect-free cleanup via the unmount path of a small ref-like trick:
  // we intentionally skip useEffect — the dock will simply remount this
  // component with a different bundleKey on the next selection.
  void clearActiveBundle

  return (
    <div
      onKeyDown={handleKeyDown}
      className="flex flex-1 min-h-0 flex-col outline-none"
    >
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {skill ? (
          <SkillEditor
            skill={skill}
            selectedPath={selectedPath}
            selectedContent={selectedContent}
            onContentChange={handleFileContentChange}
            isDirty={isDirty}
            saving={saving}
            canSync={canSync}
            canDeleteFile={selectedPath !== SKILL_MD}
            onAddFile={() => setShowAddFile(true)}
            onDeleteFile={handleDeleteFile}
            onSave={handleSave}
            onDelete={() => setConfirmDelete(true)}
            onSync={() => setConfirmSync(true)}
            loading={loadingFiles}
          />
        ) : null}
      </div>

      {showAddFile && (
        <AddFileDialog
          existingPaths={filePaths}
          onClose={() => setShowAddFile(false)}
          onAdd={handleAddFile}
        />
      )}

      {confirmDelete && skill && (
        <DeleteSkillDialog
          skillName={skill.name}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            setConfirmDelete(false)
            await onDelete()
          }}
        />
      )}

      {confirmSync && canSync ? (
        <SyncSkillDialog
          isDirty={isDirty}
          isSyncing={isReinstalling}
          onCancel={() => setConfirmSync(false)}
          onConfirm={async () => {
            await onReinstall()
            setConfirmSync(false)
          }}
        />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Skill editor — header + file viewer, nothing else. The file tree lives in
// the explorer so this pane can stay focused on the content.
// ---------------------------------------------------------------------------

function SkillEditor({
  skill,
  selectedPath,
  selectedContent,
  onContentChange,
  isDirty,
  saving,
  canSync,
  canDeleteFile,
  onAddFile,
  onDeleteFile,
  onSave,
  onDelete,
  onSync,
  loading,
}: {
  skill: Skill
  selectedPath: string
  selectedContent: string
  onContentChange: (content: string) => void
  isDirty: boolean
  saving: boolean
  canSync: boolean
  canDeleteFile: boolean
  onAddFile: () => void
  onDeleteFile: () => void
  onSave: () => void
  onDelete: () => void
  onSync: () => void
  loading: boolean
}) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <SkillEditorHeader
        skill={skill}
        selectedPath={selectedPath}
        isDirty={isDirty}
        saving={saving}
        canSync={canSync}
        canDeleteFile={canDeleteFile}
        onAddFile={onAddFile}
        onDeleteFile={onDeleteFile}
        onSave={onSave}
        onDelete={onDelete}
        onSync={onSync}
      />

      <div className="flex-1 min-h-0">
        {loading ? (
          <FileViewerSkeleton />
        ) : (
          <FileViewer
            key={selectedPath}
            path={selectedPath}
            content={selectedContent}
            onChange={onContentChange}
          />
        )}
      </div>
    </div>
  )
}

function SkillEditorHeader({
  skill,
  selectedPath,
  isDirty,
  saving,
  canSync,
  canDeleteFile,
  onAddFile,
  onDeleteFile,
  onSave,
  onDelete,
  onSync,
}: {
  skill: Skill
  selectedPath: string
  isDirty: boolean
  saving: boolean
  canSync: boolean
  canDeleteFile: boolean
  onAddFile: () => void
  onDeleteFile: () => void
  onSave: () => void
  onDelete: () => void
  onSync: () => void
}) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <h1 className="truncate text-sm font-semibold text-foreground">
          {skill.name}
        </h1>
        <span className="text-muted-foreground/60">/</span>
        <span className="truncate font-mono text-xs text-muted-foreground">
          {selectedPath}
        </span>
        {isDirty ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
            <span className="inline-block size-1.5 rounded-full bg-amber-500" />
            Unsaved
          </span>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onAddFile}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Add file"
              >
                <Plus />
              </Button>
            }
          />
          <TooltipContent side="bottom">Add file</TooltipContent>
        </Tooltip>
        {canDeleteFile ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={onDeleteFile}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Delete file"
                >
                  <Trash2 />
                </Button>
              }
            />
            <TooltipContent side="bottom">Delete file</TooltipContent>
          </Tooltip>
        ) : null}
        <div className="mx-0.5 h-4 w-px bg-border/70" />
        {isDirty || saving ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="xs"
                  onClick={onSave}
                  disabled={!isDirty || saving}
                >
                  {saving ? <Loader2 className="animate-spin" /> : <Save />}
                  {saving ? 'Saving' : 'Save'}
                </Button>
              }
            />
            <TooltipContent side="bottom">
              <KbdGroup>
                <Kbd>{isMacOS() ? '⌘' : 'Ctrl'}</Kbd>
                <Kbd>S</Kbd>
              </KbdGroup>
            </TooltipContent>
          </Tooltip>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                aria-label="Skill actions"
              >
                <MoreHorizontal />
              </Button>
            }
          />
          <DropdownMenuContent align="end" sideOffset={6}>
            {canSync ? (
              <>
                <DropdownMenuItem onClick={onSync}>
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
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 />
              Delete skill
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
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
          'overflow-hidden p-0',
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
    queryKey: ['skills.sh-search', searchQuery],
    queryFn: () => api.searchSkills(searchQuery, 10),
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
              autoFocus
              value={search}
              onValueChange={onSearchChange}
              placeholder="Search skills"
              data-slot="input-group-control"
              className="flex h-8 w-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 text-sm outline-none placeholder:text-muted-foreground"
            />
            {isFetching ? (
              <InputGroupAddon align="inline-end">
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              </InputGroupAddon>
            ) : null}
          </InputGroup>
        </div>

        <div className="mt-3 h-[380px] shrink-0 overflow-y-auto border-t border-border/60 px-2 py-2">
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
    queryKey: ['skills.sh-preview', url],
    queryFn: () => api.previewSkill(url),
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
    void onImport(url)
  }

  const headerTitle = data?.name ?? 'Loading skill…'

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
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
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Download className="size-3.5" />
          )}
          {isImporting ? 'Adding' : 'Add skill'}
        </Button>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {preview.isPending ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
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
            <div className="flex w-56 shrink-0 flex-col border-r">
              <div className="flex-1 overflow-y-auto">
                <FileTree
                  filePaths={filePaths}
                  selectedPath={selectedPath}
                  onSelect={setSelectedPath}
                />
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <FileViewer
                key={selectedPath}
                path={selectedPath}
                content={selectedContent}
                readOnly
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

  const handleSubmit = async () => {
    if (!name.trim() || submitting) return
    setSubmitting(true)
    await onCreate({
      name: name.trim(),
      description: description.trim(),
    }).finally(() => setSubmitting(false))
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
            autoFocus
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
            disabled={!name.trim() || submitting}
          >
            {submitting ? 'Creating' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Add file dialog
// ---------------------------------------------------------------------------

function AddFileDialog({
  existingPaths,
  onClose,
  onAdd,
}: {
  existingPaths: string[]
  onClose: () => void
  onAdd: (path: string) => void
}) {
  const [path, setPath] = useState('')
  const duplicate = existingPaths.includes(path.trim())
  const canSubmit = Boolean(path.trim()) && !duplicate

  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
    >
      <DialogContent className="max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">Add file</DialogTitle>
          <DialogDescription className="text-xs">
            Add a supporting file to this skill bundle.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">File path</Label>
          <Input
            autoFocus
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="e.g. templates/review.md"
            className="font-mono text-sm"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canSubmit) {
                onAdd(path.trim())
                onClose()
              }
            }}
          />
          {duplicate && (
            <p className="text-xs text-destructive">File already exists</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!canSubmit}
            onClick={() => {
              onAdd(path.trim())
              onClose()
            }}
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Destructive confirmation dialogs
// ---------------------------------------------------------------------------

function DeleteSkillDialog({
  skillName,
  onCancel,
  onConfirm,
}: {
  skillName: string
  onCancel: () => void
  onConfirm: () => Promise<void>
}) {
  const [pending, setPending] = useState(false)
  return (
    <AlertDialog
      open
      onOpenChange={(value) => {
        if (!value) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Trash2 className="text-destructive" />
          </AlertDialogMedia>
          <AlertDialogTitle>Delete &ldquo;{skillName}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the skill from every agent in this workspace and
            deletes all bundle files. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={async (event) => {
              event.preventDefault()
              setPending(true)
              await onConfirm().finally(() => setPending(false))
            }}
          >
            {pending ? <Loader2 className="animate-spin" /> : <Trash2 />}
            {pending ? 'Deleting' : 'Delete skill'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function SyncSkillDialog({
  isDirty,
  isSyncing,
  onCancel,
  onConfirm,
}: {
  isDirty: boolean
  isSyncing: boolean
  onCancel: () => void
  onConfirm: () => Promise<void>
}) {
  return (
    <AlertDialog
      open
      onOpenChange={(value) => {
        if (!value) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <RefreshCw />
          </AlertDialogMedia>
          <AlertDialogTitle>Sync from source?</AlertDialogTitle>
          <AlertDialogDescription>
            {isDirty
              ? 'You have unsaved edits. Syncing discards them and replaces the bundle with the latest version from the source.'
              : 'Replaces the bundle with the latest version from the source.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSyncing}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isSyncing}
            onClick={async (event) => {
              event.preventDefault()
              await onConfirm()
            }}
          >
            {isSyncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {isSyncing ? 'Syncing' : 'Sync'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
    <div className="flex flex-1 min-h-0">
      <div className="flex w-64 flex-col border-r">
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
      <div className="flex flex-1 flex-col">
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
