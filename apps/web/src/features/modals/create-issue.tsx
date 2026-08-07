import { useState, useRef } from 'react'
import { useNavigation } from '../navigation'
import { useWorkspaceDock } from '@/components/shell/workspace-dock'
import {
  Check,
  ChevronRight,
  Maximize2,
  Minimize2,
  X as XIcon,
} from 'lucide-react'
import { cn } from '@garden/ui/lib/utils'
import { toast } from 'sonner'
import type {
  IssueStatus,
  IssuePriority,
  IssueAssigneeType,
} from '@garden/core/types'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@garden/ui/components/ui/dialog'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@garden/ui/components/ui/tooltip'
import { Button } from '@garden/ui/components/ui/button'
import {
  ContentEditor,
  type ContentEditorRef,
  TitleEditor,
  useFileDropZone,
  FileDropOverlay,
} from '../editor'
import {
  StatusIcon,
  StatusPicker,
  PriorityPicker,
  AssigneePicker,
  DueDatePicker,
} from '../issues/components'
import { TodoAgentHintContent } from '../issues/components/todo-agent-hint-dialog'
import { ProjectPicker } from '../projects/components/project-picker'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { useIssueDraftStore } from '@garden/app-state/issues/stores/draft-store'
import { useCreateIssue, useUpdateIssue } from '@/lib/issues/mutations'
import { useFileUpload } from '@garden/app-state/hooks/use-file-upload'
import { api } from '@/lib/api'
import { FileUploadButton } from '@garden/ui/components/common/file-upload-button'

// ---------------------------------------------------------------------------
// Pill trigger — shared rounded-full button style for toolbar
// ---------------------------------------------------------------------------

function PillButton({
  children,
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn(
        'h-auto rounded-full px-2.5 py-1 text-xs hover:bg-accent/60',
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  )
}

// ---------------------------------------------------------------------------
// CreateIssueModal
// ---------------------------------------------------------------------------

export function CreateIssueModal({
  onClose,
  data,
}: {
  onClose: () => void
  data?: Record<string, unknown> | null
}) {
  const router = useNavigation()
  void router
  const dock = useWorkspaceDock()
  const workspaceName = useWorkspaceStore((s) => s.workspace?.name)

  const draft = useIssueDraftStore((s) => s.draft)
  const setDraft = useIssueDraftStore((s) => s.setDraft)
  const clearDraft = useIssueDraftStore((s) => s.clearDraft)

  const [title, setTitle] = useState(draft.title)
  const descEditorRef = useRef<ContentEditorRef>(null)
  const { isDragOver: descDragOver, dropZoneProps: descDropZoneProps } =
    useFileDropZone({
      onDrop: (files) =>
        files.forEach((f) => descEditorRef.current?.uploadFile(f)),
    })
  const [status, setStatus] = useState<IssueStatus>(
    (data?.status as IssueStatus) || draft.status,
  )
  const [priority, setPriority] = useState<IssuePriority>(draft.priority)
  const [submitting, setSubmitting] = useState(false)
  const [assigneeType, setAssigneeType] = useState<
    IssueAssigneeType | undefined
  >(draft.assigneeType)
  const [assigneeId, setAssigneeId] = useState<string | undefined>(
    draft.assigneeId,
  )
  const [dueDate, setDueDate] = useState<string | null>(draft.dueDate)
  const [projectId, setProjectId] = useState<string | undefined>(
    (data?.project_id as string) || undefined,
  )
  const [autoStart, setAutoStart] = useState(true)
  const [isExpanded, setIsExpanded] = useState(false)
  const [todoHintIssueId, setTodoHintIssueId] = useState<string | null>(null)

  // File upload — collect attachment IDs so we can link them after issue creation.
  const [attachmentIds, setAttachmentIds] = useState<string[]>([])
  const { uploadWithToast } = useFileUpload(api)
  const handleUpload = async (file: File) => {
    const result = await uploadWithToast(file)
    if (result) {
      setAttachmentIds((prev) => [...prev, result.id])
    }
    return result
  }

  // Sync field changes to draft store
  const updateTitle = (v: string) => {
    setTitle(v)
    setDraft({ title: v })
  }
  const updateStatus = (v: IssueStatus) => {
    setStatus(v)
    setDraft({ status: v })
  }
  const updatePriority = (v: IssuePriority) => {
    setPriority(v)
    setDraft({ priority: v })
  }
  const updateAssignee = (type?: IssueAssigneeType, id?: string) => {
    setAssigneeType(type)
    setAssigneeId(id)
    setDraft({ assigneeType: type, assigneeId: id })
  }
  const updateDueDate = (v: string | null) => {
    setDueDate(v)
    setDraft({ dueDate: v })
  }

  const createIssueMutation = useCreateIssue()
  const updateIssueMutation = useUpdateIssue()
  const handleSubmit = async () => {
    if (!title.trim() || submitting) return
    setSubmitting(true)
    try {
      const issue = await createIssueMutation.mutateAsync({
        title: title.trim(),
        description: descEditorRef.current?.getMarkdown()?.trim() || undefined,
        status,
        priority,
        assignee_type: assigneeType,
        assignee_id: assigneeId,
        due_date: dueDate || undefined,
        attachment_ids: attachmentIds.length > 0 ? attachmentIds : undefined,
        auto_start: autoStart,
        parent_issue_id: (data?.parent_issue_id as string) || undefined,
        project_id: projectId,
      })
      clearDraft()
      const shouldShowTodoHint =
        status === 'todo' &&
        assigneeType === 'agent' &&
        assigneeId &&
        localStorage.getItem('garden:todo-agent-hint-dismissed') !== 'true'

      if (shouldShowTodoHint) {
        setTodoHintIssueId(issue.id)
      } else {
        onClose()
      }

      if (!shouldShowTodoHint) {
        toast.custom(
          (t) => (
            <div className="bg-popover text-popover-foreground border rounded-lg shadow-lg p-4 w-[360px]">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex items-center justify-center size-5 rounded-full bg-emerald-500/15 text-emerald-500">
                  <Check className="size-3" />
                </div>
                <span className="text-sm font-medium">Issue created</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground ml-7">
                <StatusIcon
                  status={issue.status}
                  className="size-3.5 shrink-0"
                />
                <span className="truncate">
                  {issue.identifier} – {issue.title}
                </span>
              </div>
              <button
                type="button"
                className="ml-7 mt-2 text-sm text-primary hover:underline cursor-pointer"
                onClick={() => {
                  dock?.openPanel({
                    kind: 'issue-detail',
                    title: issue.title,
                    entityId: issue.id,
                  })
                  toast.dismiss(t)
                }}
              >
                View issue
              </button>
            </div>
          ),
          { duration: 5000 },
        )
      }
    } catch {
      toast.error('Failed to create issue')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) {
          setTodoHintIssueId(null)
          onClose()
        }
      }}
    >
      <DialogContent
        finalFocus={false}
        showCloseButton={false}
        className={cn(
          'p-0 gap-0 flex flex-col overflow-hidden',
          '!top-1/2 !left-1/2 !-translate-x-1/2',
          todoHintIssueId
            ? '!max-w-[480px] !w-[calc(100vw-2rem)] !h-auto !-translate-y-1/2 !transition-none !duration-0'
            : '!transition-all !duration-300 !ease-out',
          !todoHintIssueId && isExpanded
            ? '!max-w-4xl !w-full !h-5/6 !-translate-y-1/2'
            : !todoHintIssueId
              ? '!max-w-2xl !w-full !h-96 !-translate-y-1/2'
              : '',
        )}
      >
        {todoHintIssueId ? (
          <TodoAgentHintContent
            onKeepInTodo={() => {
              setTodoHintIssueId(null)
              onClose()
            }}
            onDismissPermanently={() => {
              localStorage.setItem('garden:todo-agent-hint-dismissed', 'true')
            }}
            onMoveToInProgress={() => {
              updateIssueMutation.mutate(
                { id: todoHintIssueId, status: 'in_progress' },
                { onError: () => toast.error('Failed to update status') },
              )
              setTodoHintIssueId(null)
              onClose()
            }}
          />
        ) : (
          <>
            <DialogTitle className="sr-only">New Issue</DialogTitle>

            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-3 pb-2 shrink-0">
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">{workspaceName}</span>
                <ChevronRight className="size-3 text-muted-foreground/50" />
                {typeof data?.parent_issue_identifier === 'string' && (
                  <>
                    <span className="text-muted-foreground">
                      {data.parent_issue_identifier}
                    </span>
                    <ChevronRight className="size-3 text-muted-foreground/50" />
                  </>
                )}
                <span className="font-medium">
                  {data?.parent_issue_id ? 'New sub-issue' : 'New issue'}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="rounded-sm p-1.5 opacity-70 hover:opacity-100 hover:bg-accent/60 transition-all cursor-pointer"
                      >
                        {isExpanded ? (
                          <Minimize2 className="size-4" />
                        ) : (
                          <Maximize2 className="size-4" />
                        )}
                      </button>
                    }
                  />
                  <TooltipContent side="bottom">
                    {isExpanded ? 'Collapse' : 'Expand'}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        onClick={onClose}
                        className="rounded-sm p-1.5 opacity-70 hover:opacity-100 hover:bg-accent/60 transition-all cursor-pointer"
                      >
                        <XIcon className="size-4" />
                      </button>
                    }
                  />
                  <TooltipContent side="bottom">Close</TooltipContent>
                </Tooltip>
              </div>
            </div>

            {/* Title */}
            <div className="px-5 pb-2 shrink-0">
              <TitleEditor
                autoFocus
                defaultValue={draft.title}
                placeholder="Issue title"
                className="text-lg font-semibold"
                onChange={(v) => updateTitle(v)}
                onSubmit={handleSubmit}
              />
            </div>

            {/* Description — takes remaining space */}
            <div
              {...descDropZoneProps}
              className="relative flex-1 min-h-0 overflow-y-auto px-5"
            >
              <ContentEditor
                ref={descEditorRef}
                defaultValue={draft.description}
                placeholder="Add description..."
                onUpdate={(md) => setDraft({ description: md })}
                onUploadFile={handleUpload}
                debounceMs={500}
              />
              {descDragOver && <FileDropOverlay />}
            </div>

            {/* Property toolbar */}
            <div className="flex items-center gap-1.5 px-4 py-2 shrink-0 flex-wrap">
              {/* Status */}
              <StatusPicker
                status={status}
                onUpdate={(u) => {
                  if (u.status) updateStatus(u.status)
                }}
                triggerRender={<PillButton />}
                align="start"
              />

              {/* Priority */}
              <PriorityPicker
                priority={priority}
                onUpdate={(u) => {
                  if (u.priority) updatePriority(u.priority)
                }}
                triggerRender={<PillButton />}
                align="start"
              />

              {/* Assignee */}
              <AssigneePicker
                assigneeType={assigneeType ?? null}
                assigneeId={assigneeId ?? null}
                onUpdate={(u) =>
                  updateAssignee(
                    u.assignee_type ?? undefined,
                    u.assignee_id ?? undefined,
                  )
                }
                triggerRender={<PillButton />}
                align="start"
              />

              {/* Due date */}
              <DueDatePicker
                dueDate={dueDate}
                onUpdate={(u) => updateDueDate(u.due_date ?? null)}
                triggerRender={<PillButton />}
                align="start"
              />

              {/* Project */}
              <ProjectPicker
                projectId={projectId ?? null}
                onUpdate={(u) => setProjectId(u.project_id ?? undefined)}
                triggerRender={<PillButton />}
                align="start"
              />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-4 py-3 border-t shrink-0">
              <FileUploadButton
                onSelect={(file) => descEditorRef.current?.uploadFile(file)}
              />
              <div className="flex items-center gap-3">
                {assigneeType === 'agent' &&
                assigneeId &&
                !['todo', 'blocked', 'done', 'cancelled'].includes(status) ? (
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={autoStart}
                      onChange={(event) => setAutoStart(event.target.checked)}
                      className="size-3.5 accent-primary"
                    />
                    Auto start
                  </label>
                ) : null}
                <Button
                  size="sm"
                  onClick={handleSubmit}
                  disabled={!title.trim() || submitting}
                >
                  {submitting ? 'Creating...' : 'Create Issue'}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
