'use client'

import { useState, useEffect, useMemo, useDeferredValue } from 'react'
import { Skeleton as BoneyardSkeleton } from 'boneyard-js/react'
import { useDefaultLayout } from 'react-resizable-panels'
import {
  Sparkles,
  Plus,
  Trash2,
  Save,
  AlertCircle,
  Download,
  Loader2,
  RefreshCw,
} from 'lucide-react'
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
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@garden/ui/components/ui/resizable'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@garden/ui/components/ui/tooltip'
import { Button } from '@garden/ui/components/ui/button'
import { Input } from '@garden/ui/components/ui/input'
import { Label } from '@garden/ui/components/ui/label'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@garden/ui/components/ui/tabs'
import { toast } from 'sonner'
import { cn } from '@garden/ui/lib/utils'
import { api } from '@garden/core/api'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@garden/core/auth'
import { useWorkspaceId } from '@garden/core/hooks'
import {
  skillListOptions,
  workspaceKeys,
} from '@garden/core/workspace/queries'

import { FileTree } from './file-tree'
import { FileViewer } from './file-viewer'

const SKILLS_PAGE_SKELETON = 'skills-page'
const SKILLS_FILE_TREE_SKELETON = 'skills-file-tree'
const SKILLS_FILE_VIEWER_SKELETON = 'skills-file-viewer'
const SKILLS_SH_CHIP_CLASS_NAME =
  'inline-flex max-w-full select-none items-center gap-1 rounded-md border border-fuchsia-500/25 bg-fuchsia-500/12 px-1.5 py-px font-medium text-[12px] leading-[1.1] text-fuchsia-700 align-middle dark:text-fuchsia-300'
const SKILLS_SH_HOST = 'skills.sh'

function SkillsFileTreeFixture() {
  return (
    <div className="p-3">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Files</span>
        <div className="rounded-md bg-accent px-2 py-1 text-xs text-muted-foreground">
          5
        </div>
      </div>
      <div className="space-y-1">
        {['SKILL.md', 'templates/review.md', 'notes/context.md'].map((path) => (
          <div
            key={path}
            className="rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-accent"
          >
            {path}
          </div>
        ))}
      </div>
    </div>
  )
}

function SkillsFileViewerFixture() {
  return (
    <div className="p-4 space-y-3">
      <p className="text-sm font-medium text-foreground"># Code Review</p>
      <p className="text-sm text-muted-foreground">
        Review pull requests for correctness, regressions, and missing tests.
      </p>
      <div className="space-y-2 rounded-lg border border-border/70 bg-card p-3">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          Checklist
        </p>
        <p className="text-sm text-foreground">Look for behavioral bugs first.</p>
        <p className="text-sm text-foreground">Keep summaries short and concrete.</p>
      </div>
    </div>
  )
}

function SkillsPageFixture() {
  return (
    <div className="flex flex-1 min-h-0">
      <div className="flex w-72 flex-col border-r">
        <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            3 skills
          </span>
          <div className="h-5 w-5 rounded-md bg-accent" />
        </div>
        <div className="py-1">
          {[
            ['Code Review', 'Triage risky diffs'],
            ['Bug Hunt', 'Reproduce and narrow regressions'],
            ['Docs', 'Write concise technical docs'],
          ].map(([name, description], idx) => (
            <div
              key={name}
              className={`relative flex items-center gap-2.5 py-2.5 pr-3 pl-4 ${
                idx === 0 ? 'bg-accent/60' : ''
              }`}
            >
              {idx === 0 ? (
                <span className="absolute left-0 top-1 bottom-1 w-[2px] rounded-r-sm bg-primary" />
              ) : null}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {name}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex-1 flex flex-col">
        <div className="flex h-12 shrink-0 items-center border-b px-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              Code Review
            </p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              Review pull requests for regressions
            </p>
          </div>
        </div>
        <div className="flex flex-1 min-h-0">
          <div className="w-52 border-r">
            <SkillsFileTreeFixture />
          </div>
          <div className="flex-1">
            <SkillsFileViewerFixture />
          </div>
        </div>
      </div>
    </div>
  )
}

export function SkillsFileTreeSkeleton() {
  const fixture = <SkillsFileTreeFixture />

  return (
    <BoneyardSkeleton
      name={SKILLS_FILE_TREE_SKELETON}
      loading
      fixture={fixture}
      className="h-full"
    >
      {fixture}
    </BoneyardSkeleton>
  )
}

export function SkillsFileViewerSkeleton() {
  const fixture = <SkillsFileViewerFixture />

  return (
    <BoneyardSkeleton
      name={SKILLS_FILE_VIEWER_SKELETON}
      loading
      fixture={fixture}
      className="h-full"
    >
      {fixture}
    </BoneyardSkeleton>
  )
}

export function SkillsPageSkeleton() {
  const fixture = <SkillsPageFixture />

  return (
    <BoneyardSkeleton
      name={SKILLS_PAGE_SKELETON}
      loading
      fixture={fixture}
      className="flex flex-1 min-h-0"
    >
      {fixture}
    </BoneyardSkeleton>
  )
}

function isSkillsShImportTarget(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return false

  if (URL.canParse(trimmed)) {
    return new URL(trimmed).hostname === SKILLS_SH_HOST
  }

  return trimmed
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean).length >= 3
}

function getSkillsShSearchQuery(value: string) {
  const trimmed = value.trim()
  if (!trimmed || isSkillsShImportTarget(trimmed)) return ''
  return trimmed
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

function formatSourceUrlForDisplay(url: string) {
  return url.replace(/^https?:\/\//, '')
}

// ---------------------------------------------------------------------------
// Create Skill Dialog
// ---------------------------------------------------------------------------

function CreateSkillDialog({
  onClose,
  onCreate,
  onImport,
}: {
  onClose: () => void
  onCreate: (data: CreateSkillRequest) => Promise<void>
  onImport: (url: string) => Promise<void>
}) {
  const [tab, setTab] = useState<'create' | 'import'>('create')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [importUrl, setImportUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [importError, setImportError] = useState('')
  const deferredImportUrl = useDeferredValue(importUrl.trim())
  const searchQuery = useMemo(
    () => getSkillsShSearchQuery(deferredImportUrl),
    [deferredImportUrl],
  )

  const detectedSource = isSkillsShImportTarget(importUrl) ? 'skills.sh' : null
  const skillsShSearchQuery = useQuery({
    queryKey: ['skills.sh-search', searchQuery],
    queryFn: () => api.searchSkills(searchQuery, 8),
    enabled: tab === 'import' && searchQuery.length >= 2,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  })

  const handleCreate = async () => {
    if (!name.trim()) return
    setLoading(true)
    try {
      await onCreate({ name: name.trim(), description: description.trim() })
      onClose()
    } catch {
      setLoading(false)
    }
  }

  const handleImport = async () => {
    if (!importUrl.trim() || searchQuery.length >= 2) return
    setLoading(true)
    setImportError('')
    try {
      await onImport(importUrl.trim())
      onClose()
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed')
      setLoading(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Skill</DialogTitle>
          <DialogDescription>
            Author a new skill or import one from skills.sh.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as 'create' | 'import')}
        >
          <TabsList className="w-full">
            <TabsTrigger value="create" className="flex-1">
              <Plus className="mr-1.5 h-3 w-3" />
              Create
            </TabsTrigger>
            <TabsTrigger value="import" className="flex-1">
              <Download className="mr-1.5 h-3 w-3" />
              Import
            </TabsTrigger>
          </TabsList>

          <TabsContent value="create" className="space-y-4 mt-4 min-h-[180px]">
            <div>
              <Label className="text-xs text-muted-foreground">Name</Label>
              <Input
                autoFocus
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Code Review, Bug Triage"
                className="mt-1"
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">
                Description
              </Label>
              <Input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of what this skill does"
                className="mt-1"
              />
            </div>
          </TabsContent>

          <TabsContent value="import" className="space-y-4 mt-4 min-h-[180px]">
            <div>
              <Label className="text-xs text-muted-foreground">
                Search or paste a skills.sh URL
              </Label>
              <Input
                autoFocus
                type="text"
                value={importUrl}
                onChange={(e) => {
                  setImportUrl(e.target.value)
                  setImportError('')
                }}
                placeholder="Search skills.sh or paste owner/repo/skill"
                className="mt-1"
                onKeyDown={(e) => e.key === 'Enter' && handleImport()}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Import keeps the full bundle layout intact so `SKILL.md`,
                templates, scripts, and references stay mounted together.
              </p>
            </div>

            <div className="rounded-xl border border-border/80 bg-muted/20 p-3">
              <div className="flex items-center gap-2">
                <span className={SKILLS_SH_CHIP_CLASS_NAME}>skills.sh</span>
                <p className="text-xs text-muted-foreground">
                  Search, import, and later sync the canonical bundle from
                  skills.sh.
                </p>
              </div>
            </div>

            {searchQuery.length >= 2 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    skills.sh results
                  </p>
                  {skillsShSearchQuery.isFetching ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Searching
                    </span>
                  ) : null}
                </div>
                <div className="overflow-hidden rounded-xl border border-border/80 bg-popover/96 shadow-sm">
                  {skillsShSearchQuery.data?.length ? (
                    <div className="divide-y divide-border/70">
                      {skillsShSearchQuery.data.map((skill) => {
                        const candidateUrl = buildSkillsShUrl(skill)
                        const isSelected = importUrl.trim() === candidateUrl

                        return (
                          <button
                            key={skill.id}
                            type="button"
                            onClick={() => {
                              setImportUrl(candidateUrl)
                              setImportError('')
                            }}
                            className={cn(
                              'flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-transparent hover:text-inherit',
                              isSelected && 'bg-accent text-accent-foreground',
                            )}
                          >
                            <span className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground/80">
                              <Sparkles className="size-3.5" />
                            </span>
                            <span className="flex min-w-0 flex-1 items-center gap-2">
                              <span className="shrink-0 text-sm font-medium">
                                {skill.name}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground/70">
                                {skill.source}
                              </span>
                            </span>
                            <span className="shrink-0 pl-2 text-xs text-muted-foreground/70">
                              {formatInstallCount(skill.installs)} installs
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  ) : skillsShSearchQuery.isFetching ? (
                    <div className="px-3 py-4 text-xs text-muted-foreground">
                      Searching skills.sh…
                    </div>
                  ) : (
                    <div className="px-3 py-4 text-xs text-muted-foreground">
                      No skills found for “{searchQuery}”.
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {detectedSource === 'skills.sh' ? (
              <div className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/6 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className={SKILLS_SH_CHIP_CLASS_NAME}>skills.sh</span>
                  <span className="truncate font-mono text-[11px] text-muted-foreground">
                    {formatSourceUrlForDisplay(importUrl.trim())}
                  </span>
                </div>
              </div>
            ) : null}

            {importError && (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {importError}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {tab === 'create' ? (
            <Button onClick={handleCreate} disabled={loading || !name.trim()}>
              {loading ? 'Creating...' : 'Create'}
            </Button>
          ) : (
            <Button
              onClick={handleImport}
              disabled={loading || !importUrl.trim() || searchQuery.length >= 2}
            >
              {loading ? (
                detectedSource === 'skills.sh' ? (
                  'Importing from Skills.sh...'
                ) : (
                  'Importing...'
                )
              ) : (
                <>
                  <Download className="mr-1.5 h-3 w-3" />
                  Import
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Skill List Item
// ---------------------------------------------------------------------------

function SkillListItem({
  skill,
  isSelected,
  onClick,
}: {
  skill: Skill
  isSelected: boolean
  onClick: () => void
}) {
  const fileCount = skill.files?.length ?? 0
  return (
    <button
      onClick={onClick}
      className={cn(
        'group relative flex w-full items-center gap-2.5 py-2.5 pr-3 pl-4 text-left transition-colors',
        'before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[2px] before:rounded-r-sm before:transition-colors',
        isSelected
          ? 'bg-accent/60 before:bg-primary'
          : 'before:bg-transparent hover:bg-accent/30',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <div
            className={cn(
              'truncate text-sm leading-tight',
              isSelected
                ? 'font-semibold text-foreground'
                : 'font-medium text-foreground/90',
            )}
          >
            {skill.name}
          </div>
          {skill.source_type === 'skills.sh' ? (
            <span className={cn(SKILLS_SH_CHIP_CLASS_NAME, 'shrink-0')}>
              skills.sh
            </span>
          ) : null}
        </div>
        {skill.description ? (
          <div className="mt-0.5 truncate text-xs text-muted-foreground leading-tight">
            {skill.description}
          </div>
        ) : null}
      </div>
      {fileCount > 0 ? (
        <span
          className={cn(
            'shrink-0 text-[11px] tabular-nums tracking-tight',
            isSelected ? 'text-muted-foreground' : 'text-muted-foreground/60',
          )}
        >
          {fileCount}
        </span>
      ) : null}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Helpers: virtual file list for the tree
// ---------------------------------------------------------------------------

const SKILL_MD = 'SKILL.md'

/** Merge skill.content (as SKILL.md) + skill.files into a single map */
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

// ---------------------------------------------------------------------------
// Add File Dialog
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

  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
    >
      <DialogContent className="max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">Add File</DialogTitle>
          <DialogDescription className="text-xs">
            Add a supporting file to this skill.
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label className="text-xs text-muted-foreground">File Path</Label>
          <Input
            autoFocus
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="e.g. templates/review.md"
            className="mt-1 font-mono text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && path.trim() && !duplicate) {
                onAdd(path.trim())
                onClose()
              }
            }}
          />
          {duplicate && (
            <p className="mt-1 text-xs text-destructive">File already exists</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!path.trim() || duplicate}
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
// Skill Detail — file-browser layout
// ---------------------------------------------------------------------------

function SkillDetail({
  skill,
  onUpdate,
  onDelete,
  onReinstall,
}: {
  skill: Skill
  onUpdate: (id: string, data: UpdateSkillRequest) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onReinstall: (skill: Skill) => Promise<void>
}) {
  const qc = useQueryClient()
  const wsId = useWorkspaceId()
  const [content, setContent] = useState(skill.content)
  const [files, setFiles] = useState<{ path: string; content: string }[]>(
    (skill.files ?? []).map((f) => ({ path: f.path, content: f.content })),
  )
  const [selectedPath, setSelectedPath] = useState(SKILL_MD)
  const [saving, setSaving] = useState(false)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmSync, setConfirmSync] = useState(false)
  const [showAddFile, setShowAddFile] = useState(false)
  const [syncing, setSyncing] = useState(false)

  // Sync content from store updates
  useEffect(() => {
    setContent(skill.content)
  }, [skill.id, skill.content])

  // Fetch full skill (with files) on selection change
  useEffect(() => {
    setSelectedPath(SKILL_MD)
    setLoadingFiles(true)
    api
      .getSkill(skill.id)
      .then((full) => {
        qc.invalidateQueries({ queryKey: workspaceKeys.skills(wsId) })
        setFiles(
          (full.files ?? []).map((f) => ({ path: f.path, content: f.content })),
        )
      })
      .catch((e) => {
        toast.error(
          e instanceof Error ? e.message : 'Failed to load skill files',
        )
      })
      .finally(() => setLoadingFiles(false))
  }, [skill.id, qc, wsId])

  // Build the virtual file map
  const fileMap = useMemo(() => buildFileMap(content, files), [content, files])
  const filePaths = useMemo(() => Array.from(fileMap.keys()), [fileMap])
  const selectedContent = fileMap.get(selectedPath) ?? ''

  const isDirty =
    content !== skill.content ||
    JSON.stringify(files) !==
      JSON.stringify(
        (skill.files ?? []).map((f) => ({ path: f.path, content: f.content })),
      )
  const canSync = skill.source_type === 'skills.sh' && Boolean(skill.source_url)

  const handleSave = async () => {
    setSaving(true)
    try {
      await onUpdate(skill.id, {
        content,
        files: files.filter((f) => f.path.trim()),
      })
    } catch {
      // toast handled by parent
    } finally {
      setSaving(false)
    }
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex min-h-12 shrink-0 items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <div className="truncate text-sm font-semibold leading-tight text-foreground">
              {skill.name}
            </div>
            {skill.source_type === 'skills.sh' ? (
              <span className={SKILLS_SH_CHIP_CLASS_NAME}>skills.sh</span>
            ) : null}
          </div>
          {skill.description ? (
            <div className="truncate text-xs text-muted-foreground leading-tight mt-0.5">
              {skill.description}
            </div>
          ) : null}
          {skill.source_url ? (
            <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground/80">
              {formatSourceUrlForDisplay(skill.source_url)}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canSync ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setConfirmSync(true)}
              disabled={syncing}
              className="text-muted-foreground"
            >
              {syncing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {syncing ? 'Syncing…' : 'Sync'}
            </Button>
          ) : null}
          {isDirty && (
            <Button onClick={handleSave} disabled={saving} size="xs">
              <Save className="h-3 w-3" />
              {saving ? 'Saving…' : 'Save'}
            </Button>
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setConfirmDelete(true)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              }
            />
            <TooltipContent>Delete skill</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {canSync ? (
        <div className="border-b bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
          Sync replaces the imported snapshot and bundle files with the latest
          source from skills.sh.
        </div>
      ) : null}

      {/* File browser: tree + viewer */}
      <div className="flex flex-1 min-h-0">
        {/* File tree */}
        <div className="w-52 shrink-0 border-r flex flex-col">
          <div className="flex h-12 shrink-0 items-center justify-between border-b px-3">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-[0.14em]">
              Files
            </span>
            <div className="flex items-center gap-0.5">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setShowAddFile(true)}
                      className="text-muted-foreground"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  }
                />
                <TooltipContent>Add file</TooltipContent>
              </Tooltip>
              {selectedPath !== SKILL_MD && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={handleDeleteFile}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    }
                  />
                  <TooltipContent>Delete file</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingFiles ? (
              <SkillsFileTreeSkeleton />
            ) : (
              <BoneyardSkeleton
                name={SKILLS_FILE_TREE_SKELETON}
                loading={loadingFiles}
                className="h-full"
              >
                <FileTree
                  filePaths={filePaths}
                  selectedPath={selectedPath}
                  onSelect={setSelectedPath}
                />
              </BoneyardSkeleton>
            )}
          </div>
        </div>

        {/* File viewer */}
        <div className="flex-1 min-w-0">
          {loadingFiles ? (
            <SkillsFileViewerSkeleton />
          ) : (
            <BoneyardSkeleton
              name={SKILLS_FILE_VIEWER_SKELETON}
              loading={loadingFiles}
              className="h-full"
            >
              <FileViewer
                key={selectedPath}
                path={selectedPath}
                content={selectedContent}
                onChange={handleFileContentChange}
              />
            </BoneyardSkeleton>
          )}
        </div>
      </div>

      {/* Add file dialog */}
      {showAddFile && (
        <AddFileDialog
          existingPaths={filePaths}
          onClose={() => setShowAddFile(false)}
          onAdd={handleAddFile}
        />
      )}

      {/* Delete Confirmation */}
      {confirmDelete && (
        <Dialog
          open
          onOpenChange={(v) => {
            if (!v) setConfirmDelete(false)
          }}
        >
          <DialogContent className="max-w-sm" showCloseButton={false}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                <AlertCircle className="h-5 w-5 text-destructive" />
              </div>
              <DialogHeader className="flex-1 gap-1">
                <DialogTitle className="text-sm font-semibold">
                  Delete skill?
                </DialogTitle>
                <DialogDescription className="text-xs">
                  This will permanently delete &quot;{skill.name}&quot; and
                  remove it from all agents.
                </DialogDescription>
              </DialogHeader>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  setConfirmDelete(false)
                  onDelete(skill.id)
                }}
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {confirmSync && canSync ? (
        <Dialog
          open
          onOpenChange={(value) => {
            if (!value) setConfirmSync(false)
          }}
        >
          <DialogContent className="max-w-sm" showCloseButton={false}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-fuchsia-500/10">
                <RefreshCw className="h-5 w-5 text-fuchsia-700 dark:text-fuchsia-300" />
              </div>
              <DialogHeader className="flex-1 gap-1">
                <DialogTitle className="text-sm font-semibold">
                  Sync from skills.sh?
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {isDirty
                    ? 'You have unsaved edits in this editor. Syncing will discard them and replace the imported snapshot and bundle files with the latest skills.sh bundle.'
                    : 'This replaces the imported snapshot and bundle files with the latest skills.sh bundle.'}
                </DialogDescription>
              </DialogHeader>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmSync(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setSyncing(true)
                  void onReinstall(skill).finally(() => {
                    setSyncing(false)
                    setConfirmSync(false)
                  })
                }}
                disabled={syncing}
              >
                {syncing ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Syncing…
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-3 w-3" />
                    Sync
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SkillsPage() {
  const isLoading = useAuthStore((s) => s.isLoading)
  const qc = useQueryClient()
  const wsId = useWorkspaceId()
  const { data: skills = [] } = useQuery(skillListOptions(wsId))
  const [selectedId, setSelectedId] = useState<string>('')
  const [showCreate, setShowCreate] = useState(false)
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'accelerate_skills_layout',
  })

  useEffect(() => {
    if (skills.length > 0 && !selectedId) {
      setSelectedId(skills[0]!.id)
    }
  }, [skills, selectedId])

  const handleCreate = async (data: CreateSkillRequest) => {
    const skill = await api.createSkill(data)
    qc.invalidateQueries({ queryKey: workspaceKeys.skills(wsId) })
    setSelectedId(skill.id)
    toast.success('Skill created')
  }

  const handleImport = async (url: string) => {
    const skill = await api.importSkill({ url })
    await qc.invalidateQueries({ queryKey: workspaceKeys.skills(wsId) })
    setSelectedId(skill.id)
    toast.success('Skill imported from skills.sh')
  }

  const handleUpdate = async (id: string, data: UpdateSkillRequest) => {
    try {
      await api.updateSkill(id, data)
      qc.invalidateQueries({ queryKey: workspaceKeys.skills(wsId) })
      toast.success('Skill saved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save skill')
      throw e
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await api.deleteSkill(id)
      if (selectedId === id) {
        const remaining = skills.filter((s) => s.id !== id)
        setSelectedId(remaining[0]?.id ?? '')
      }
      qc.invalidateQueries({ queryKey: workspaceKeys.skills(wsId) })
      toast.success('Skill deleted')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete skill')
    }
  }

  const handleReinstall = async (skill: Skill) => {
    if (!skill.source_url) return
    const next = await api.importSkill({ url: skill.source_url })
    await qc.invalidateQueries({ queryKey: workspaceKeys.skills(wsId) })
    setSelectedId(next.id)
    toast.success('Skill synced from skills.sh')
  }

  const selected = skills.find((s) => s.id === selectedId) ?? null
  const isEmpty = skills.length === 0

  // Empty state renders outside BoneyardSkeleton so it can use the full dock
  // panel height — BoneyardSkeleton wraps children in a plain div that blocks
  // flex-1 propagation, collapsing h-full/flex-1 children to content size.
  if (!isLoading && isEmpty) {
    return (
      <>
        <LibraryEmptyState onCreate={() => setShowCreate(true)} />
        {showCreate && (
          <CreateSkillDialog
            onClose={() => setShowCreate(false)}
            onCreate={handleCreate}
            onImport={handleImport}
          />
        )}
      </>
    )
  }

  return (
    <BoneyardSkeleton
      name={SKILLS_PAGE_SKELETON}
      loading={isLoading}
      className="flex flex-1 min-h-0"
    >
      {!isLoading ? (
        <ResizablePanelGroup
          orientation="horizontal"
          className="flex-1 min-h-0"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
        >
          <ResizablePanel
            id="list"
            defaultSize={280}
            minSize={240}
            maxSize={400}
            groupResizeBehavior="preserve-pixel-size"
          >
            {/* Left column — skill list */}
            <div className="flex h-full flex-col border-r">
              <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
                <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground tabular-nums">
                  {skills.length} {skills.length === 1 ? 'skill' : 'skills'}
                </span>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setShowCreate(true)}
                      >
                        <Plus className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    }
                  />
                  <TooltipContent side="bottom">New skill</TooltipContent>
                </Tooltip>
              </div>
              <div className="flex-1 overflow-y-auto py-1">
                {skills.map((skill) => (
                  <SkillListItem
                    key={skill.id}
                    skill={skill}
                    isSelected={skill.id === selectedId}
                    onClick={() => setSelectedId(skill.id)}
                  />
                ))}
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle />

          <ResizablePanel id="detail" minSize="50%">
            {/* Right column — skill detail */}
            <div className="h-full min-h-0 overflow-hidden">
              {selected ? (
                <SkillDetail
                  key={selected.id}
                  skill={selected}
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                  onReinstall={handleReinstall}
                />
              ) : null}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : null}

      {showCreate && (
        <CreateSkillDialog
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
          onImport={handleImport}
        />
      )}
    </BoneyardSkeleton>
  )
}

function LibraryEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex h-full w-full items-center justify-center px-6">
      <div className="flex max-w-sm flex-col items-center text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Sparkles className="h-5 w-5 text-muted-foreground" />
        </div>
        <h2 className="mt-4 text-base font-semibold tracking-tight text-foreground">
          Your library is empty
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          Author a skill from scratch or import a full bundle from skills.sh.
        </p>
        <Button onClick={onCreate} size="sm" className="mt-5">
          <Plus className="h-3.5 w-3.5" />
          New skill
        </Button>
      </div>
    </div>
  )
}
