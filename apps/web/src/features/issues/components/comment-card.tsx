import { useRef, useState } from 'react'
import {
  CornerUpLeft,
  Copy,
  Download,
  FileText,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '@garden/ui/components/ui/card'
import { Button } from '@garden/ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@garden/ui/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@garden/ui/components/ui/tooltip'
import { ConfirmDialog } from '@garden/ui/components/common/confirm-dialog'
import {
  Collapsible,
  CollapsibleContent,
} from '@garden/ui/components/ui/collapsible'
import { ActorAvatar } from '../../common/actor-avatar'
import { ReactionBar } from '@garden/ui/components/common/reaction-bar'
import { QuickEmojiPicker } from '@garden/ui/components/common/quick-emoji-picker'
import { cn } from '@garden/ui/lib/utils'
import { useActorName } from '@/lib/workspace/hooks'
import { timeAgo } from '@garden/core/format'
import {
  ContentEditor,
  type ContentEditorRef,
  copyMarkdown,
  ReadonlyContent,
  useFileDropZone,
  FileDropOverlay,
} from '../../editor'
import { FileUploadButton } from '@garden/ui/components/common/file-upload-button'
import { useAttachmentUpload } from '@/lib/hooks/use-attachment-upload'
import { ReplyInput } from './reply-input'
import type { TimelineEntry, Attachment } from '@garden/core/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CommentCardProps {
  issueId: string
  entry: TimelineEntry
  allReplies: Map<string, TimelineEntry[]>
  currentUserId?: string
  /** Resolves true when the reply was sent. */
  onReply: (
    parentId: string,
    content: string,
    attachmentIds?: string[],
  ) => Promise<boolean>
  /** Resolves true when the edit was saved; edit mode closes only then. */
  onEdit: (commentId: string, content: string) => Promise<boolean>
  /** Resolves true when the comment was deleted. */
  onDelete: (commentId: string) => Promise<boolean>
  onToggleReaction: (commentId: string, emoji: string) => void
  /** ID of the comment to highlight (flash animation). */
  highlightedCommentId?: string | null
}

// ---------------------------------------------------------------------------
// Shared delete confirmation dialog
// ---------------------------------------------------------------------------

function DeleteCommentDialog({
  open,
  onOpenChange,
  onConfirm,
  hasReplies,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<boolean>
  hasReplies?: boolean
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete comment"
      description={
        hasReplies
          ? 'This comment and all its replies will be permanently deleted. This cannot be undone.'
          : 'This comment will be permanently deleted. This cannot be undone.'
      }
      confirmLabel="Delete"
      pendingLabel="Deleting…"
      tone="destructive"
      onConfirm={async () => {
        // Rejecting keeps the dialog open; the failure is already toasted.
        if (!(await onConfirm())) throw new Error('Comment was not deleted')
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// Standalone attachment list — renders attachments not already in the markdown
// ---------------------------------------------------------------------------

function AttachmentList({
  attachments,
  content,
  className,
}: {
  attachments?: Attachment[]
  content?: string
  className?: string
}) {
  if (!attachments?.length) return null
  // Skip attachments whose URL is already referenced in the markdown content
  const standalone = content
    ? attachments.filter((a) => !content.includes(a.url))
    : attachments
  if (!standalone.length) return null

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {standalone.map((a) => (
        <div
          key={a.id}
          className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-2.5 py-1 transition-colors hover:bg-muted"
        >
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{a.filename}</p>
          </div>
          {a.download_url && (
            // A labelled link rather than an unnamed button calling
            // window.open, so it can be read out and opened in a new tab.
            <a
              href={a.download_url}
              download={a.filename}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Download ${a.filename}`}
              className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Download className="size-3.5" aria-hidden />
            </a>
          )}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Single comment row (used for both parent and replies within the same Card)
// ---------------------------------------------------------------------------

function CommentRow({
  issueId,
  entry,
  currentUserId,
  onEdit,
  onDelete,
  onToggleReaction,
}: {
  issueId: string
  entry: TimelineEntry
  currentUserId?: string
  onEdit: (commentId: string, content: string) => Promise<boolean>
  /** Resolves true when the comment was deleted. */
  onDelete: (commentId: string) => Promise<boolean>
  onToggleReaction: (commentId: string, emoji: string) => void
}) {
  const { getActorName } = useActorName()
  const [editing, setEditing] = useState(false)
  const editEditorRef = useRef<ContentEditorRef>(null)
  const cancelledRef = useRef(false)
  const { uploadWithToast } = useAttachmentUpload()
  const { isDragOver, dropZoneProps } = useFileDropZone({
    onDrop: (files) =>
      files.forEach((f) => editEditorRef.current?.uploadFile(f)),
    enabled: editing,
  })

  const isOwn =
    entry.actor_type === 'member' && entry.actor_id === currentUserId
  const isTemp = entry.id.startsWith('temp-')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const startEdit = () => {
    cancelledRef.current = false
    setEditing(true)
  }

  const cancelEdit = () => {
    cancelledRef.current = true
    setEditing(false)
  }

  const saveEdit = async () => {
    if (cancelledRef.current) return
    const trimmed = editEditorRef.current
      ?.getMarkdown()
      ?.replace(/(\n\s*)+$/, '')
      .trim()
    if (!trimmed || trimmed === (entry.content ?? '').trim()) {
      setEditing(false)
      return
    }
    // onEdit reports failure itself; keep the editor open with the text.
    if (await onEdit(entry.id, trimmed)) setEditing(false)
  }

  const reactions = entry.reactions ?? []

  return (
    <div className={`py-3${isTemp ? ' opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <ActorAvatar
          actorType={entry.actor_type}
          actorId={entry.actor_id}
          label={entry.actor_label}
          size={24}
        />
        <span className="min-w-0 max-w-full truncate text-sm font-medium">
          {entry.actor_label ??
            getActorName(entry.actor_type, entry.actor_id ?? '')}
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="shrink-0 text-xs text-muted-foreground cursor-default">
                {timeAgo(entry.created_at)}
              </span>
            }
          />
          <TooltipContent side="top">
            {new Date(entry.created_at).toLocaleString()}
          </TooltipContent>
        </Tooltip>

        {!isTemp && (
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    aria-label="Comment actions"
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground"
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    copyMarkdown(entry.content ?? '')
                    toast.success('Copied')
                  }}
                >
                  <Copy className="size-3.5" />
                  Copy
                </DropdownMenuItem>
                {isOwn && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={startEdit}>
                      <Pencil className="size-3.5" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setConfirmDelete(true)}
                      variant="destructive"
                    >
                      <Trash2 className="size-3.5" />
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <DeleteCommentDialog
              open={confirmDelete}
              onOpenChange={setConfirmDelete}
              onConfirm={() => onDelete(entry.id)}
            />
          </div>
        )}
      </div>

      {editing ? (
        <div
          {...dropZoneProps}
          className="relative mt-1.5 pl-8"
          onKeyDown={(e) => {
            if (e.key === 'Escape') cancelEdit()
          }}
        >
          <div className="text-sm leading-relaxed">
            <ContentEditor
              ref={editEditorRef}
              defaultValue={entry.content ?? ''}
              placeholder="Edit comment..."
              onSubmit={saveEdit}
              onUploadFile={(file) => uploadWithToast(file, { issueId })}
              debounceMs={100}
            />
          </div>
          <div className="flex items-center justify-between mt-2">
            <FileUploadButton
              size="sm"
              onSelect={(file) => editEditorRef.current?.uploadFile(file)}
            />
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={cancelEdit}>
                Cancel
              </Button>
              <Button size="sm" variant="outline" onClick={saveEdit}>
                Save
              </Button>
            </div>
          </div>
          {isDragOver && <FileDropOverlay />}
        </div>
      ) : (
        <>
          <div className="mt-1.5 min-w-0 pl-8 text-sm leading-relaxed text-foreground/85 [overflow-wrap:anywhere]">
            <ReadonlyContent content={entry.content ?? ''} />
          </div>
          <AttachmentList
            attachments={entry.attachments}
            content={entry.content}
            className="mt-1.5 pl-8"
          />
          {!isTemp && (
            <ReactionBar
              reactions={reactions}
              currentUserId={currentUserId}
              onToggle={(emoji) => onToggleReaction(entry.id, emoji)}
              getActorName={getActorName}
              hideAddButton={false}
              className="mt-1.5 pl-8"
            />
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// CommentCard — One Card per thread (parent + all replies flat inside)
// ---------------------------------------------------------------------------

function CommentCard({
  issueId,
  entry,
  allReplies,
  currentUserId,
  onReply,
  onEdit,
  onDelete,
  onToggleReaction,
  highlightedCommentId,
}: CommentCardProps) {
  const { getActorName } = useActorName()
  const { uploadWithToast } = useAttachmentUpload()
  const [open, setOpen] = useState(true)
  const [editing, setEditing] = useState(false)
  const [replyOpen, setReplyOpen] = useState(false)
  const editEditorRef = useRef<ContentEditorRef>(null)
  const cancelledRef = useRef(false)
  const { isDragOver: parentDragOver, dropZoneProps: parentDropZoneProps } =
    useFileDropZone({
      onDrop: (files) =>
        files.forEach((f) => editEditorRef.current?.uploadFile(f)),
      enabled: editing,
    })

  const isOwn =
    entry.actor_type === 'member' && entry.actor_id === currentUserId
  const isTemp = entry.id.startsWith('temp-')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const startEdit = () => {
    cancelledRef.current = false
    // The editor lives inside CollapsibleContent; a collapsed thread hides it.
    setOpen(true)
    setEditing(true)
  }

  const cancelEdit = () => {
    cancelledRef.current = true
    setEditing(false)
  }

  const saveEdit = async () => {
    if (cancelledRef.current) return
    const trimmed = editEditorRef.current
      ?.getMarkdown()
      ?.replace(/(\n\s*)+$/, '')
      .trim()
    if (!trimmed || trimmed === (entry.content ?? '').trim()) {
      setEditing(false)
      return
    }
    // onEdit reports failure itself; keep the editor open with the text.
    if (await onEdit(entry.id, trimmed)) setEditing(false)
  }

  // Collect all nested replies recursively into a flat list
  const allNestedReplies: TimelineEntry[] = []
  const collectReplies = (parentId: string) => {
    const children = allReplies.get(parentId) ?? []
    for (const child of children) {
      allNestedReplies.push(child)
      collectReplies(child.id)
    }
  }
  collectReplies(entry.id)

  const replyCount = allNestedReplies.length
  const contentPreview = (entry.content ?? '').replace(/\n/g, ' ').slice(0, 80)
  const reactions = entry.reactions ?? []

  const isHighlighted = highlightedCommentId === entry.id

  return (
    <Card
      className={cn(
        'gap-0 min-w-0 overflow-hidden rounded-xl border-0 bg-card p-3 shadow-none ring-0 transition-colors duration-700 sm:p-5',
        isTemp && 'opacity-60',
        isHighlighted && 'ring-2 ring-brand/50 bg-brand/5',
      )}
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="mb-2">
          <div className="flex items-start gap-3">
            <ActorAvatar
              actorType={entry.actor_type}
              actorId={entry.actor_id}
              label={entry.actor_label}
              size={32}
            />
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5 pt-1">
              <span className="min-w-0 max-w-full break-words text-sm font-semibold [overflow-wrap:anywhere]">
                {entry.actor_label ??
                  getActorName(entry.actor_type, entry.actor_id ?? '')}
              </span>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="text-xs text-muted-foreground cursor-default">
                      <span aria-hidden="true">· </span>
                      {timeAgo(entry.created_at)}
                    </span>
                  }
                />
                <TooltipContent side="top">
                  {new Date(entry.created_at).toLocaleString()}
                </TooltipContent>
              </Tooltip>
            </div>

            {!open && contentPreview && (
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {contentPreview}
              </span>
            )}
            {!open && replyCount > 0 && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
              </span>
            )}

            {!isTemp && (
              <div className="ml-auto flex shrink-0 items-center gap-0.5">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        aria-label="Comment actions"
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground"
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => setOpen((current) => !current)}
                    >
                      {open ? 'Collapse thread' : 'Expand thread'}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => {
                        copyMarkdown(entry.content ?? '')
                        toast.success('Copied')
                      }}
                    >
                      <Copy className="size-3.5" />
                      Copy
                    </DropdownMenuItem>
                    {isOwn && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={startEdit}>
                          <Pencil className="size-3.5" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => setConfirmDelete(true)}
                          variant="destructive"
                        >
                          <Trash2 className="size-3.5" />
                          Delete
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                <DeleteCommentDialog
                  open={confirmDelete}
                  onOpenChange={setConfirmDelete}
                  onConfirm={() => onDelete(entry.id)}
                  hasReplies
                />
              </div>
            )}
          </div>
        </div>

        {/* Collapsible body */}
        <CollapsibleContent>
          {/* Parent comment body */}
          <div className="pb-2.5">
            {editing ? (
              <div
                {...parentDropZoneProps}
                className="relative pl-[44px]"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') cancelEdit()
                }}
              >
                <div className="text-sm leading-relaxed">
                  <ContentEditor
                    ref={editEditorRef}
                    defaultValue={entry.content ?? ''}
                    placeholder="Edit comment..."
                    onSubmit={saveEdit}
                    onUploadFile={(file) => uploadWithToast(file, { issueId })}
                    debounceMs={100}
                  />
                </div>
                <div className="flex items-center justify-between mt-2">
                  <FileUploadButton
                    size="sm"
                    onSelect={(file) => editEditorRef.current?.uploadFile(file)}
                  />
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={cancelEdit}>
                      Cancel
                    </Button>
                    <Button size="sm" variant="outline" onClick={saveEdit}>
                      Save
                    </Button>
                  </div>
                </div>
                {parentDragOver && <FileDropOverlay />}
              </div>
            ) : (
              <>
                <div className="min-w-0 pl-[44px] text-sm leading-relaxed text-foreground/85 [overflow-wrap:anywhere] [&_[data-mention-type=agent]]:rounded-md">
                  <ReadonlyContent content={entry.content ?? ''} />
                </div>
                <AttachmentList
                  attachments={entry.attachments}
                  content={entry.content}
                  className="mt-1.5 pl-[44px]"
                />
                {!isTemp && (
                  <div className="mt-4 pl-[44px] flex flex-wrap items-center gap-2">
                    <QuickEmojiPicker
                      onSelect={(emoji) => onToggleReaction(entry.id, emoji)}
                    />
                    <ReactionBar
                      reactions={reactions}
                      currentUserId={currentUserId}
                      onToggle={(emoji) => onToggleReaction(entry.id, emoji)}
                      getActorName={getActorName}
                      hideAddButton
                    />
                    {!replyOpen && allNestedReplies.length === 0 && (
                      <button
                        type="button"
                        onClick={() => setReplyOpen(true)}
                        className="inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-ring"
                      >
                        <CornerUpLeft className="size-3.5" />
                        Reply
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
            <div className="ml-[44px] mt-4 border-t border-border/60" />
          </div>

          {/* Replies */}
          {allNestedReplies.map((reply) => (
            <div
              key={reply.id}
              id={`comment-${reply.id}`}
              className={cn(
                'min-w-0 border-t border-border/50 px-1 transition-colors duration-700 sm:px-4',
                highlightedCommentId === reply.id && 'bg-brand/5',
              )}
            >
              <CommentRow
                issueId={issueId}
                entry={reply}
                currentUserId={currentUserId}
                onEdit={onEdit}
                onDelete={onDelete}
                onToggleReaction={onToggleReaction}
              />
            </div>
          ))}

          {/* Reply input — only shown when there are replies or the user
          clicked Reply. Otherwise the comment ends at its body, keeping the
          activity stream quiet when threads are empty. */}
          {(replyOpen || allNestedReplies.length > 0) && (
            <div className="min-w-0 border-t border-border/50 px-1 py-2.5 sm:px-4">
              <ReplyInput
                issueId={issueId}
                placeholder="Leave a reply..."
                size="sm"
                avatarType="member"
                avatarId={currentUserId ?? ''}
                submitOnEnter
                autoFocus={replyOpen}
                onCancel={
                  allNestedReplies.length === 0
                    ? () => setReplyOpen(false)
                    : undefined
                }
                onSubmit={async (content, attachmentIds) => {
                  const sent = await onReply(entry.id, content, attachmentIds)
                  if (sent) setReplyOpen(false)
                  return sent
                }}
              />
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

export { CommentCard, type CommentCardProps }
