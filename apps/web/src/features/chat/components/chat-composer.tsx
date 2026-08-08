/**
 * Chat composer subsystem.
 *
 * Extracted from `agent-interaction-screen.tsx` to keep the parent file small.
 * Owns the input box (text, attachments, skills, structured questions) and
 * the file-upload pipeline that backs it.
 *
 * Exports:
 *   - `Composer` — the actual input + send/stop UI.
 *   - `SkillGlyph` — the small badge icon used by chips both here and in the
 *     header attachment menu.
 *   - `normalizeStatus`, `createFileList`, `shouldPersistAsDocument`,
 *     `uploadAgentDocuments` — small helpers also used by the parent.
 *   - Type `PreviewAttachment`, constants `COMPOSER_INLINE_*` and
 *     `ACCEPTED_FILE_TYPES` — shared with `HeaderAttachmentsMenu`/`MessageFiles`
 *     in the parent file.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Result } from 'better-result'
import {
  ArrowUp,
  ChevronDown,
  FileText,
  Loader2,
  Mic,
  Paperclip,
  Shield,
  ShieldCheck,
  StopCircle,
  X,
} from 'lucide-react'
import { uploadThreadDocument } from '@/lib/api'
import { Button } from '@garden/ui/components/ui/button'
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@garden/ui/components/ui/command'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@garden/ui/components/ui/dropdown-menu'
import { Textarea } from '@garden/ui/components/ui/textarea'
import { cn } from '@garden/ui/lib/utils'
import { SpeechInput } from '@/components/ai-elements/speech-input'
import { useQuery } from '@tanstack/react-query'
import {
  agentSkillListOptions,
  memberListOptions,
} from '@/lib/workspace/queries'
import { useWorkspaceId } from '@garden/app-state/hooks'
import {
  type ComposerSkill,
  type RealtimeStatus,
} from '../chat-runtime-provider'
import { detectSkillTrigger, formatSkillInvocation } from './skill-invocation'
import { searchComposerSkills } from './skill-search'
import {
  detectMemberMentionTrigger,
  isMemberMentionSelectionKey,
  rebaseMemberMentions,
  resolveMemberMentionTextEdit,
  searchComposerMembers,
  serializeMemberMentions,
  type SelectedMemberMention,
} from './member-mention'
import { StructuredInputPanel } from './structured-input-panel'
import type { SelectedThreadDocument } from './document-selection'
import {
  FileKindIcon,
  getFileKind,
  getFileKindLabel,
} from './chat-document-panel'
import type {
  StructuredQuestion,
  StructuredQuestionAnswers,
} from '@garden/app-state/chat'
import { ActorAvatar } from '../../common/actor-avatar'

export type PreviewAttachment = {
  id: string
  file: File
  previewUrl: string
}

export type ComposerThreadDocument = SelectedThreadDocument & {
  meta: string
}

export const COMPOSER_INLINE_CHIP_ICON_CLASS_NAME =
  'size-3.5 shrink-0 opacity-85'
export const COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME =
  'truncate select-none leading-tight'
export const COMPOSER_INLINE_SKILL_CHIP_CLASS_NAME =
  'inline-flex max-w-full select-none items-center gap-1 rounded-md border border-fuchsia-500/25 bg-fuchsia-500/12 px-1.5 py-px font-medium text-xs leading-tight text-fuchsia-700 align-middle dark:text-fuchsia-300'

export function normalizeStatus(status: RealtimeStatus) {
  return status === 'ready' ? 'idle' : status
}

export function SkillGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.85"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  )
}

// ACCEPTED_FILE_TYPES is the composer picker's accept attribute AND the
// allowlist used by paste/drop. Images, PDFs, Word docs, plain text, markdown,
// CSV, JSON.
// Kept as a single source of truth so all three ingest paths agree.
export const ACCEPTED_FILE_TYPES =
  'image/*,application/pdf,.pdf,.doc,.docx,.txt,.md,.markdown,.csv,.json,text/plain,text/markdown,text/csv,application/json,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export function createFileList(files: File[]) {
  const transfer = new DataTransfer()
  files.forEach((file) => transfer.items.add(file))
  return transfer.files
}

export function shouldPersistAsDocument(file: File) {
  return getFileKind({ mediaType: file.type, filename: file.name }) !== 'image'
}

export async function uploadAgentDocuments(args: {
  files: File[]
  threadId: string
}) {
  const uploaded: Array<{
    document_id: string
    filename: string
    version_number?: number | null
  }> = []
  for (const file of args.files) {
    const result = await Result.tryPromise({
      try: async () => {
        const payload = await uploadThreadDocument({
          file,
          threadId: args.threadId,
        })
        if (!payload.ok || !payload.document_id) {
          throw new Error(payload.error ?? `Upload failed for ${file.name}`)
        }
        return payload
      },
      catch: (error) =>
        error instanceof Error ? error : new Error(String(error)),
    })
    if (result.isErr()) return result
    const documentId = result.value.document_id
    if (!documentId)
      return Result.err(new Error(`Upload failed for ${file.name}`))
    uploaded.push({
      document_id: documentId,
      filename: result.value.filename ?? file.name,
      version_number: result.value.version_number ?? null,
    })
  }
  return Result.ok(uploaded)
}

export function Composer({
  agentId,
  documentLoadState,
  documents,
  isStreaming,
  status,
  input,
  onInputChange,
  onSend,
  onStop,
  onWarmRuntime,
  pendingQuestions,
  onSubmitAnswers,
}: {
  agentId: string
  documentLoadState: 'error' | 'loading' | 'ready'
  documents: ComposerThreadDocument[]
  isStreaming: boolean
  status: RealtimeStatus
  input: string
  onInputChange: (value: string) => void
  onSend: (payload: {
    text: string
    files: File[]
    selectedDocuments: SelectedThreadDocument[]
  }) => Promise<void>
  onStop: () => void
  onWarmRuntime?: () => void
  pendingQuestions?: StructuredQuestion[]
  onSubmitAnswers?: (answers: StructuredQuestionAnswers) => void
}) {
  const [attachments, setAttachments] = useState<PreviewAttachment[]>([])
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const pendingTextEditRef = useRef<{
    selectionStart: number
    selectionEnd: number
    inputType: string
  } | null>(null)
  const [cursor, setCursor] = useState(() => input.length)
  const workspaceId = useWorkspaceId()
  const selectedDocuments = useMemo(
    () =>
      selectedDocumentIds.flatMap((documentId) => {
        const document = documents.find(
          (candidate) => candidate.documentId === documentId,
        )
        return document ? [document] : []
      }),
    [documents, selectedDocumentIds],
  )
  const hasStaleDocumentSelection =
    selectedDocuments.length !== selectedDocumentIds.length
  const [highlightedSkillIndex, setHighlightedSkillIndex] = useState(0)
  const [skillMenuDismissed, setSkillMenuDismissed] = useState(false)
  const [highlightedMemberIndex, setHighlightedMemberIndex] = useState(0)
  const [memberMenuDismissed, setMemberMenuDismissed] = useState(false)
  const [selectedMemberMentions, setSelectedMemberMentions] = useState<
    SelectedMemberMention[]
  >([])
  const [permissionMode, setPermissionMode] = useState<'ask' | 'accept-all'>(
    'ask',
  )
  // Drag depth counter — dragenter/dragleave fire for child elements too, so
  // we have to count entries and exits to know when we've actually left the
  // drop zone. Count nested entries so child transitions do not clear it.
  const dragDepthRef = useRef(0)
  const [isDragging, setIsDragging] = useState(false)
  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    const nextHeight = Math.min(textarea.scrollHeight, 200)
    textarea.style.height = `${Math.max(nextHeight, 28)}px`
    textarea.style.overflowY = textarea.scrollHeight > 200 ? 'auto' : 'hidden'
  }, [])

  // Track latest attachments in a ref so unmount cleanup doesn't fire on
  // every re-render (the previous effect revoked URLs still referenced by
  // rendered <img src=...> nodes). Revocation on remove/clear happens
  // inline in the event handlers.
  const attachmentsRef = useRef(attachments)
  attachmentsRef.current = attachments
  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach((item) =>
        URL.revokeObjectURL(item.previewUrl),
      )
    }
  }, [])

  useLayoutEffect(() => {
    resizeTextarea()
  }, [input, resizeTextarea])

  const clearAttachments = () => {
    attachments.forEach((item) => URL.revokeObjectURL(item.previewUrl))
    setAttachments([])
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleFiles = (fileList: FileList | File[] | null) => {
    if (!fileList) return
    const array = Array.isArray(fileList) ? fileList : Array.from(fileList)
    if (array.length === 0) return
    const next = array.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
    }))
    setAttachments((current) => [...current, ...next])
  }

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData?.files ?? [])
    if (files.length === 0) return
    // Text paste gets the default behaviour — only intercept when files are
    // actually on the clipboard (e.g. screenshot from Cmd-Shift-4, or a file
    // copied from Finder).
    event.preventDefault()
    handleFiles(files)
  }

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer?.types?.includes('Files')) return
    event.preventDefault()
    dragDepthRef.current += 1
    setIsDragging(true)
  }

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer?.types?.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer?.types?.includes('Files')) return
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setIsDragging(false)
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer?.types?.includes('Files')) return
    event.preventDefault()
    dragDepthRef.current = 0
    setIsDragging(false)
    handleFiles(event.dataTransfer.files)
  }

  const handleSubmit = async () => {
    if (isStreaming) {
      await onStop()
      return
    }

    if (normalizeStatus(status) === 'submitted') return

    if (
      (!input.trim() &&
        attachments.length === 0 &&
        selectedDocuments.length === 0) ||
      hasStaleDocumentSelection
    ) {
      return
    }
    const serializedInput = serializeMemberMentions(
      input,
      selectedMemberMentions,
    ).trim()
    // Clear the composer optimistically. sendMessage below resolves only
    // after the full streaming turn finishes, so deferring the clear would
    // leave the input/attachments visible for the entire assistant reply.
    const files = attachments.map((item) => item.file)
    onInputChange('')
    setSelectedMemberMentions([])
    clearAttachments()
    setSelectedDocumentIds([])
    await onSend({ text: serializedInput, files, selectedDocuments })
  }

  const skillTrigger = useMemo(
    () => detectSkillTrigger(input, cursor),
    [cursor, input],
  )
  const memberTrigger = useMemo(
    () => detectMemberMentionTrigger(input, cursor),
    [cursor, input],
  )
  const membersQuery = useQuery(memberListOptions(workspaceId))
  const filteredMembers = useMemo(
    () =>
      memberTrigger
        ? searchComposerMembers(membersQuery.data ?? [], memberTrigger.query)
        : [],
    [memberTrigger, membersQuery.data],
  )
  const enabledSkillsQuery = useQuery({
    ...agentSkillListOptions(workspaceId, agentId),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: (previous) => previous,
  })
  const skills = useMemo<ComposerSkill[]>(
    () =>
      (enabledSkillsQuery.data ?? [])
        .filter((skill) => skill.enabled)
        .map((skill) => ({
          id: skill.id,
          slug: skill.slug ?? skill.name,
          name: skill.name,
          description: skill.description,
        })),
    [enabledSkillsQuery.data],
  )
  const filteredSkills = useMemo(() => {
    if (!skillTrigger) return [] as ComposerSkill[]
    return searchComposerSkills(skills, skillTrigger.query)
  }, [skillTrigger, skills])
  useEffect(() => {
    setHighlightedSkillIndex(0)
  }, [skillTrigger?.query])

  useEffect(() => {
    setSkillMenuDismissed(false)
  }, [input, skillTrigger?.query])

  const applySkillSelection = useCallback(
    (skill: ComposerSkill) => {
      if (!skillTrigger) return
      const slug = skill.slug ?? skill.name
      const replacement = formatSkillInvocation(slug) + ' '
      let rangeEnd = skillTrigger.rangeEnd
      if (input[rangeEnd] === ' ') {
        rangeEnd += 1
      }
      const nextValue =
        input.slice(0, skillTrigger.rangeStart) +
        replacement +
        input.slice(rangeEnd)
      const nextCursor = skillTrigger.rangeStart + replacement.length
      setSkillMenuDismissed(false)
      setSelectedMemberMentions((current) =>
        rebaseMemberMentions(input, nextValue, current, {
          previousStart: skillTrigger.rangeStart,
          previousEnd: rangeEnd,
          nextEnd: skillTrigger.rangeStart + replacement.length,
        }),
      )
      onInputChange(nextValue)
      setCursor(nextCursor)
      requestAnimationFrame(() => {
        const textarea = textareaRef.current
        if (!textarea) return
        textarea.focus()
        textarea.setSelectionRange(nextCursor, nextCursor)
      })
    },
    [input, onInputChange, skillTrigger],
  )

  const applyMemberSelection = useCallback(
    (member: (typeof filteredMembers)[number]) => {
      if (!memberTrigger) return
      const replacement = `@${member.name} `
      let rangeEnd = memberTrigger.rangeEnd
      if (input[rangeEnd] === ' ') rangeEnd += 1
      const nextValue =
        input.slice(0, memberTrigger.rangeStart) +
        replacement +
        input.slice(rangeEnd)
      const nextCursor = memberTrigger.rangeStart + replacement.length

      const mentionEnd = memberTrigger.rangeStart + replacement.trimEnd().length
      setSelectedMemberMentions((current) => [
        ...rebaseMemberMentions(input, nextValue, current, {
          previousStart: memberTrigger.rangeStart,
          previousEnd: rangeEnd,
          nextEnd: memberTrigger.rangeStart + replacement.length,
        }),
        {
          id: member.user_id,
          label: member.name,
          start: memberTrigger.rangeStart,
          end: mentionEnd,
        },
      ])
      setMemberMenuDismissed(false)
      onInputChange(nextValue)
      setCursor(nextCursor)
      requestAnimationFrame(() => {
        const textarea = textareaRef.current
        if (!textarea) return
        textarea.focus()
        textarea.setSelectionRange(nextCursor, nextCursor)
      })
    },
    [filteredMembers, input, memberTrigger, onInputChange],
  )

  return (
    <div className="shrink-0 bg-background/95 px-4 pb-3 pt-2 backdrop-blur">
      {selectedDocumentIds.length > 0 ? (
        <div className="mx-auto mb-2 flex max-w-2xl gap-2 overflow-x-auto pb-1">
          {selectedDocumentIds.map((documentId) => {
            const document = documents.find(
              (candidate) => candidate.documentId === documentId,
            )
            return (
              <div
                key={documentId}
                className={cn(
                  'group relative flex h-14 w-52 shrink-0 items-center gap-2.5 rounded-lg border bg-muted/40 px-3',
                  !document && 'border-destructive/40',
                )}
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-xs font-medium">
                    {document?.filename ?? 'Document unavailable'}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {document?.meta ?? 'Remove and select it again'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedDocumentIds((current) =>
                      current.filter((id) => id !== documentId),
                    )
                  }
                  className="absolute right-1 top-1 rounded-full bg-background/85 p-1 text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label={`Remove ${document?.filename ?? 'unavailable document'}`}
                >
                  <X className="size-3" />
                </button>
              </div>
            )
          })}
        </div>
      ) : null}

      {attachments.length > 0 ? (
        <div className="mx-auto mb-2 flex max-w-2xl gap-2 overflow-x-auto pb-1">
          {attachments.map((item) => {
            const kind = getFileKind({
              mediaType: item.file.type,
              filename: item.file.name,
            })
            const isImage = kind === 'image'
            return (
              <div
                key={item.id}
                className={cn(
                  'group relative shrink-0 overflow-hidden rounded-lg border bg-muted/40',
                  isImage
                    ? 'h-20 w-24'
                    : 'flex h-20 w-44 items-center gap-2.5 px-3',
                )}
                title={item.file.name}
              >
                {isImage ? (
                  <img
                    src={item.previewUrl}
                    alt={item.file.name}
                    className="size-full object-cover"
                  />
                ) : (
                  <>
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-background/70">
                      <FileKindIcon
                        kind={kind}
                        className="text-foreground/70"
                      />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-xs font-medium leading-tight">
                        {item.file.name}
                      </span>
                      <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
                        {getFileKindLabel(kind)}
                      </span>
                    </div>
                  </>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setAttachments((current) => {
                      const next = current.filter(
                        (entry) => entry.id !== item.id,
                      )
                      URL.revokeObjectURL(item.previewUrl)
                      return next
                    })
                  }
                  className="absolute right-1 top-1 rounded-full bg-background/85 p-1 text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label={`Remove ${item.file.name}`}
                >
                  <X className="size-3" />
                </button>
              </div>
            )
          })}
        </div>
      ) : null}

      <div className="mx-auto max-w-2xl">
        <div
          className={cn(
            // Vellum pill — hairline inset instead of drop shadow, per design.
            // The focus state grows a 1.5px moss ring so the composer reads as
            // armed without piling another layer of shadow on top.
            'relative rounded-[2rem] bg-card p-2.5 shadow-[var(--shadow-hairline)] transition-[box-shadow] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] focus-within:shadow-[0_0_0_1.5px_color-mix(in_oklab,var(--ring)_45%,transparent),var(--shadow-hairline)]',
            isDragging &&
              'shadow-[0_0_0_1.5px_color-mix(in_oklab,var(--primary)_45%,transparent),var(--shadow-hairline)]',
          )}
          onClick={(event) => {
            // Click anywhere on the composer card focuses the textarea,
            // giving the whole surface interactive feel.
            if (event.target === event.currentTarget) {
              textareaRef.current?.focus()
            }
          }}
          onPointerEnter={onWarmRuntime}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDragging ? (
            <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-[2rem] border border-dashed border-primary/70 bg-primary/5 backdrop-blur-[1px]">
              <div className="flex items-center gap-2 rounded-full bg-background/90 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm">
                <Paperclip className="size-3.5 text-primary" />
                Drop to attach
              </div>
            </div>
          ) : null}
          {pendingQuestions &&
          pendingQuestions.length > 0 &&
          onSubmitAnswers ? (
            <StructuredInputPanel
              questions={pendingQuestions}
              onSubmit={onSubmitAnswers}
              disabled={isStreaming}
            />
          ) : null}
          {skillTrigger && !skillMenuDismissed ? (
            <div className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-[2rem] border bg-card shadow-sm">
              <Command
                shouldFilter={false}
                className="rounded-[2rem]! bg-card p-1"
              >
                <CommandList className="max-h-72">
                  {filteredSkills.length > 0 ? (
                    <CommandGroup heading="Skills">
                      {filteredSkills.map((skill, index) => (
                        <CommandItem
                          key={skill.id}
                          value={skill.id}
                          className={cn(
                            'cursor-pointer select-none gap-2 hover:bg-transparent hover:text-inherit data-[selected=true]:bg-transparent data-[selected=true]:text-inherit',
                            highlightedSkillIndex === index &&
                              'text-primary font-medium',
                          )}
                          onMouseMove={() => {
                            if (highlightedSkillIndex !== index) {
                              setHighlightedSkillIndex(index)
                            }
                          }}
                          onMouseDown={(event) => {
                            event.preventDefault()
                          }}
                          onSelect={() => applySkillSelection(skill)}
                          onClick={() => applySkillSelection(skill)}
                        >
                          <span className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground/80">
                            <SkillGlyph className="size-3.5" />
                          </span>
                          <span className="flex min-w-0 flex-1 items-center gap-2">
                            <span className="shrink-0">
                              {formatSkillInvocation(skill.slug ?? skill.name)}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-muted-foreground/70 text-xs">
                              {skill.description || 'Workspace skill'}
                            </span>
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ) : enabledSkillsQuery.isError ? (
                    <div className="px-3 py-2.5">
                      <p className="text-xs text-destructive">
                        Failed to load skills. Try again later.
                      </p>
                    </div>
                  ) : enabledSkillsQuery.isFetching && skills.length === 0 ? (
                    <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground/70">
                      <Loader2 className="size-3.5 animate-spin" />
                      <span>Loading skills...</span>
                    </div>
                  ) : (
                    <div className="px-3 py-2.5">
                      <p className="text-muted-foreground/70 text-xs">
                        {skills.length === 0
                          ? 'No skills available for this agent.'
                          : 'No matching skills.'}
                      </p>
                    </div>
                  )}
                </CommandList>
              </Command>
            </div>
          ) : memberTrigger && !memberMenuDismissed ? (
            <div className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-xl bg-card shadow-[var(--shadow-float-1)]">
              <Command shouldFilter={false} className="bg-card p-1">
                <CommandList className="max-h-72">
                  {filteredMembers.length > 0 ? (
                    <CommandGroup heading="Members">
                      {filteredMembers.map((member, index) => (
                        <CommandItem
                          key={member.user_id}
                          value={member.user_id}
                          className={cn(
                            'cursor-pointer select-none gap-2',
                            highlightedMemberIndex === index &&
                              'bg-lichen/20 text-moss',
                          )}
                          onMouseMove={() => setHighlightedMemberIndex(index)}
                          onMouseDown={(event) => event.preventDefault()}
                          onSelect={() => applyMemberSelection(member)}
                          onClick={() => applyMemberSelection(member)}
                        >
                          <ActorAvatar
                            actorType="member"
                            actorId={member.user_id}
                            size={20}
                          />
                          <span className="min-w-0 flex-1 truncate font-medium">
                            @{member.name}
                          </span>
                          <span className="max-w-40 truncate text-xs text-muted-foreground">
                            {member.email}
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ) : membersQuery.isFetching ? (
                    <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" />
                      <span>Loading members…</span>
                    </div>
                  ) : (
                    <div className="px-3 py-2.5 text-xs text-muted-foreground">
                      No matching members
                    </div>
                  )}
                </CommandList>
              </Command>
            </div>
          ) : null}
          <div className="px-3 pb-1 pt-2.5 sm:px-3.5 sm:pt-3">
            <Textarea
              ref={textareaRef}
              value={input}
              rows={1}
              onBeforeInput={(event) => {
                pendingTextEditRef.current = {
                  selectionStart: event.currentTarget.selectionStart ?? cursor,
                  selectionEnd: event.currentTarget.selectionEnd ?? cursor,
                  inputType: (event.nativeEvent as InputEvent).inputType ?? '',
                }
              }}
              onChange={(event) => {
                const nextValue = event.target.value
                const pendingEdit = pendingTextEditRef.current
                pendingTextEditRef.current = null
                setSelectedMemberMentions((current) =>
                  rebaseMemberMentions(
                    input,
                    nextValue,
                    current,
                    pendingEdit
                      ? resolveMemberMentionTextEdit({
                          previousInput: input,
                          nextInput: nextValue,
                          ...pendingEdit,
                        })
                      : undefined,
                  ),
                )
                onInputChange(nextValue)
                setHighlightedMemberIndex(0)
                setMemberMenuDismissed(false)
                resizeTextarea()
              }}
              placeholder="Tell me anything — @ people, / skills"
              style={{ height: 28, maxHeight: 200 }}
              className="[field-sizing:fixed]! min-h-7 resize-none overflow-hidden border-0 bg-transparent p-0 text-sm leading-relaxed shadow-none focus-visible:ring-0 dark:bg-transparent"
              onFocus={onWarmRuntime}
              onClick={(event) =>
                setCursor(event.currentTarget.selectionStart ?? input.length)
              }
              onKeyUp={(event) =>
                setCursor(event.currentTarget.selectionStart ?? input.length)
              }
              onSelect={(event) =>
                setCursor(event.currentTarget.selectionStart ?? input.length)
              }
              onPaste={handlePaste}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return
                if (memberTrigger && !memberMenuDismissed) {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setMemberMenuDismissed(true)
                    return
                  }
                  if (filteredMembers.length > 0) {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault()
                      setHighlightedMemberIndex(
                        (current) => (current + 1) % filteredMembers.length,
                      )
                      return
                    }
                    if (event.key === 'ArrowUp') {
                      event.preventDefault()
                      setHighlightedMemberIndex(
                        (current) =>
                          (current - 1 + filteredMembers.length) %
                          filteredMembers.length,
                      )
                      return
                    }
                    if (
                      isMemberMentionSelectionKey({
                        key: event.key,
                        isComposing: event.nativeEvent.isComposing,
                      })
                    ) {
                      event.preventDefault()
                      const member =
                        filteredMembers[highlightedMemberIndex] ??
                        filteredMembers[0]
                      if (member) applyMemberSelection(member)
                      return
                    }
                  }
                }
                if (skillTrigger && filteredSkills.length > 0) {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    setHighlightedSkillIndex(
                      (current) => (current + 1) % filteredSkills.length,
                    )
                    return
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    setHighlightedSkillIndex(
                      (current) =>
                        (current - 1 + filteredSkills.length) %
                        filteredSkills.length,
                    )
                    return
                  }
                  if (event.key === 'Tab') {
                    event.preventDefault()
                    const skill =
                      filteredSkills[highlightedSkillIndex] ?? filteredSkills[0]
                    if (skill) {
                      applySkillSelection(skill)
                    }
                    return
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setSkillMenuDismissed(true)
                    return
                  }
                }
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault()
                  void handleSubmit()
                }
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-2 px-1.5 pt-0.5">
            <div className="flex items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1.5 rounded-full px-2.5 text-muted-foreground transition-colors hover:text-foreground"
                      aria-label="Tool permissions"
                    >
                      {permissionMode === 'accept-all' ? (
                        <ShieldCheck className="size-4" />
                      ) : (
                        <Shield className="size-4" />
                      )}
                      <span className="text-xs tabular-nums">
                        {permissionMode === 'accept-all'
                          ? 'Accept all'
                          : 'Always ask'}
                      </span>
                      <ChevronDown className="size-3 opacity-60" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="start" sideOffset={6}>
                  <DropdownMenuRadioGroup
                    value={permissionMode}
                    onValueChange={(value) =>
                      setPermissionMode(value as 'ask' | 'accept-all')
                    }
                  >
                    <DropdownMenuRadioItem value="ask">
                      <Shield className="size-4 shrink-0 text-muted-foreground" />
                      <div className="flex flex-col">
                        <span className="text-sm">Always ask</span>
                        <span className="text-muted-foreground/70 text-xs">
                          Confirm every tool use
                        </span>
                      </div>
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="accept-all">
                      <ShieldCheck className="size-4 shrink-0 text-muted-foreground" />
                      <div className="flex flex-col">
                        <span className="text-sm">Accept all</span>
                        <span className="text-muted-foreground/70 text-xs">
                          Auto-approve tool calls
                        </span>
                      </div>
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="flex items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-9"
                      aria-label="Add files or existing documents"
                    >
                      <Paperclip className="size-5" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Add context</DropdownMenuLabel>
                    <DropdownMenuItem
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Paperclip className="size-4" />
                      Upload from computer
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>
                      Documents in this chat
                    </DropdownMenuLabel>
                    {documentLoadState === 'loading' ? (
                      <DropdownMenuItem disabled>
                        <Loader2 className="size-4 animate-spin" />
                        Loading documents…
                      </DropdownMenuItem>
                    ) : documentLoadState === 'error' ? (
                      <DropdownMenuItem disabled>
                        Couldn’t load documents
                      </DropdownMenuItem>
                    ) : documents.length === 0 ? (
                      <DropdownMenuItem disabled>
                        No documents in this chat yet
                      </DropdownMenuItem>
                    ) : (
                      documents.map((document) => (
                        <DropdownMenuCheckboxItem
                          key={document.documentId}
                          checked={selectedDocumentIds.includes(
                            document.documentId,
                          )}
                          onCheckedChange={(checked) =>
                            setSelectedDocumentIds((current) =>
                              checked
                                ? current.includes(document.documentId)
                                  ? current
                                  : [...current, document.documentId]
                                : current.filter(
                                    (id) => id !== document.documentId,
                                  ),
                            )
                          }
                        >
                          <FileText className="size-4" />
                          <span className="min-w-0 flex-1 truncate">
                            {document.filename}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {document.versionNumber
                              ? `V${document.versionNumber}`
                              : document.meta}
                          </span>
                        </DropdownMenuCheckboxItem>
                      ))
                    )}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              {isStreaming ? (
                <Button
                  type="button"
                  className="size-9 rounded-full bg-rose-500/90 text-white transition-all duration-150 hover:scale-105 hover:bg-rose-500"
                  onClick={() => void onStop()}
                  aria-label="Stop generation"
                >
                  <StopCircle className="size-5" />
                </Button>
              ) : !input.trim() &&
                attachments.length === 0 &&
                selectedDocuments.length === 0 ? (
                <SpeechInput
                  variant="ghost"
                  size="icon"
                  className="size-9"
                  onTranscriptionChange={(value) =>
                    onInputChange(input ? `${input.trimEnd()} ${value}` : value)
                  }
                >
                  <Mic className="size-5" />
                </SpeechInput>
              ) : (
                <Button
                  type="button"
                  className={cn(
                    'size-9 rounded-full bg-primary/90 text-primary-foreground transition-all duration-150 hover:scale-105 hover:bg-primary disabled:opacity-30 disabled:hover:scale-100',
                    // Subtle "armed" glow when there's something to send —
                    // signals the UI is ready without adding a separate badge.
                    (input.trim() ||
                      attachments.length > 0 ||
                      selectedDocuments.length > 0) &&
                      normalizeStatus(status) !== 'submitted' &&
                      'shadow-[0_0_0_2px_color-mix(in_oklab,var(--primary)_20%,transparent)]',
                  )}
                  onClick={() => void handleSubmit()}
                  disabled={
                    normalizeStatus(status) === 'submitted' ||
                    hasStaleDocumentSelection ||
                    (!input.trim() &&
                      attachments.length === 0 &&
                      selectedDocuments.length === 0)
                  }
                  aria-label={
                    normalizeStatus(status) === 'submitted'
                      ? 'Sending'
                      : 'Send message'
                  }
                >
                  {normalizeStatus(status) === 'submitted' ? (
                    <Loader2 className="size-5 animate-spin" />
                  ) : (
                    <ArrowUp className="size-5" />
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        hidden
        accept={ACCEPTED_FILE_TYPES}
        multiple
        onChange={(event) => {
          handleFiles(event.target.files)
          // Reset so re-selecting the same file re-triggers change.
          event.target.value = ''
        }}
      />
    </div>
  )
}
