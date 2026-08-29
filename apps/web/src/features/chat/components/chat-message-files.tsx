/**
 * File-attachment rendering for chat messages.
 *
 * Extracted from `agent-interaction-screen.tsx`. Owns:
 *   - `MessageFiles` — the per-message attachments grid that opens
 *     ImageLightbox or DocumentViewerDialog on click.
 *   - `HeaderAttachmentsMenu` — the dropdown shown in the chat header
 *     listing all files / documents in the active session.
 *   - Helpers: `buildMessageHeaderAttachments`, `filePartToAttachmentData`,
 *     and the local `AttachmentViewerState` discriminated union.
 */

import { useMemo, useState } from 'react'
import { Download, FileText, Paperclip } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@garden/ui/components/ui/dropdown-menu'
import { cn } from '@garden/ui/lib/utils'
import {
  Attachments,
  Attachment,
  AttachmentPreview,
} from '@/components/ai-elements/attachments'
import type { AttachmentData } from '@/components/ai-elements/attachments'
import type { ChatUiMessage } from '../chat-runtime-provider'
import {
  DocumentViewerDialog,
  ImageLightbox,
  getFileKind,
  getFileKindLabel,
  isImageAttachment,
  type FileMessagePart,
} from './chat-document-panel'
import {
  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME,
  COMPOSER_INLINE_SKILL_CHIP_CLASS_NAME,
} from './chat-composer'

// ─── Shared types ────────────────────────────────────────────────────────────

export type ChatHeaderAttachment = {
  href?: string | null
  id: string
  label: string
  meta: string
  source: 'document' | 'file'
  versionId?: string | null
  versionNumber?: number | null
}

export const EMPTY_CHAT_HEADER_ATTACHMENTS: ChatHeaderAttachment[] = []

export function buildMessageHeaderAttachments(messages: ChatUiMessage[]) {
  const seen = new Set<string>()
  const attachments: ChatHeaderAttachment[] = []

  for (const message of messages) {
    const files = message.parts.filter(
      (part): part is FileMessagePart => part.type === 'file',
    )

    for (const [index, file] of files.entries()) {
      const key = file.url || `${message.id}:${file.filename ?? index}`
      if (seen.has(key)) continue
      seen.add(key)
      const kind = getFileKind(file)
      attachments.push({
        href: file.url,
        id: `file:${key}`,
        label: file.filename ?? 'Attachment',
        meta: file.mediaType ?? getFileKindLabel(kind),
        source: 'file',
      })
    }
  }

  return attachments
}

type AttachmentViewerState =
  | { kind: 'image'; files: FileMessagePart[]; index: number }
  | { kind: 'document'; file: FileMessagePart }
  | null

export function filePartToAttachmentData(
  file: FileMessagePart,
  messageId: string,
  index: number,
): AttachmentData {
  return {
    ...file,
    id: `${messageId}:file:${file.filename ?? index}`,
  } as AttachmentData
}

export function MessageFiles({ message }: { message: ChatUiMessage }) {
  const files = message.parts.filter(
    (part): part is FileMessagePart => part.type === 'file',
  )
  const [viewer, setViewer] = useState<AttachmentViewerState>(null)
  const imageFiles = useMemo(() => files.filter(isImageAttachment), [files])

  if (files.length === 0) return null

  return (
    <>
      <Attachments variant="grid">
        {files.map((file, index) => {
          const kind = getFileKind(file)
          const data = filePartToAttachmentData(file, message.id, index)

          return (
            <Attachment
              key={data.id}
              data={data}
              className="cursor-pointer"
              onClick={() => {
                if (kind === 'image') {
                  const imageIndex = imageFiles.indexOf(file)
                  setViewer({
                    kind: 'image',
                    files: imageFiles,
                    index: imageIndex,
                  })
                } else {
                  setViewer({ kind: 'document', file })
                }
              }}
            >
              <AttachmentPreview />
            </Attachment>
          )
        })}
      </Attachments>

      {viewer?.kind === 'image' ? (
        <ImageLightbox
          files={viewer.files}
          index={viewer.index}
          onClose={() => setViewer(null)}
          onChangeIndex={(nextIndex) =>
            setViewer({
              kind: 'image',
              files: viewer.files,
              index: nextIndex,
            })
          }
        />
      ) : null}

      {viewer?.kind === 'document' ? (
        <DocumentViewerDialog
          file={viewer.file}
          onClose={() => setViewer(null)}
        />
      ) : null}
    </>
  )
}

export function HeaderAttachmentsMenu({
  attachments,
  onOpenAttachment,
}: {
  attachments: ChatHeaderAttachment[]
  onOpenAttachment?: (attachment: ChatHeaderAttachment) => void
}) {
  if (attachments.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              COMPOSER_INLINE_SKILL_CHIP_CLASS_NAME,
              'h-6 max-w-[11rem] cursor-pointer px-2 text-fuchsia-700 transition-colors hover:border-fuchsia-500/40 hover:bg-fuchsia-500/18 dark:text-fuchsia-300',
            )}
            aria-label={`View ${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`}
            title="View attachments"
          >
            <Paperclip className={COMPOSER_INLINE_CHIP_ICON_CLASS_NAME} />
            <span className={COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME}>
              {attachments.length}
            </span>
          </button>
        }
      />
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Attachments</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <div className="max-h-72 overflow-y-auto">
            {attachments.map((attachment) =>
              attachment.href ? (
                <DropdownMenuItem
                  key={attachment.id}
                  onClick={() => {
                    if (onOpenAttachment) {
                      onOpenAttachment(attachment)
                      return
                    }
                    window.open(attachment.href ?? '', '_blank', 'noreferrer')
                  }}
                >
                  <FileText className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {attachment.label}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {attachment.meta}
                    </span>
                  </span>
                  <Download className="size-3.5 text-muted-foreground" />
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem key={attachment.id} disabled>
                  <FileText className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {attachment.label}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {attachment.meta}
                    </span>
                  </span>
                </DropdownMenuItem>
              ),
            )}
          </div>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
