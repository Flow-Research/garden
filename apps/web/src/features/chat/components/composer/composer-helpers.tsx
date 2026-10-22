/**
 * Composer helpers — small, dependency-light pieces shared by the composer
 * (`./composer.tsx`) and by other chat components that render the same
 * chips/badges (`../chat-message-files.tsx`, `../chat-timeline.tsx`).
 *
 * Relocated verbatim (Task 12, 2026-09-08 chat composer overhaul) from the
 * former `../chat-composer.tsx`, which was decomposed into this `./composer/`
 * subsystem and deleted in Task 13. This module is now the only home for
 * these helpers; consumers reach them through `./index.ts`.
 *
 * File is `.tsx` (not `.ts`) because `SkillGlyph` renders JSX.
 */

import { Result } from 'better-result'
import { uploadThreadDocument } from '@/lib/api'
import type { RealtimeStatus } from '../../chat-runtime-provider'
import type { SelectedThreadDocument } from '../document-selection'
import { getFileKind } from '../chat-document-panel'

export type PreviewAttachment = {
  id: string
  file: File
  previewUrl: string
}

export type ComposerThreadDocument = SelectedThreadDocument & {
  meta: string
}

export const COMPOSER_WIDTH_CLASS_NAME = 'max-w-[808px]'

export const COMPOSER_INLINE_CHIP_ICON_CLASS_NAME =
  'size-3.5 shrink-0 opacity-85'
export const COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME =
  'truncate select-none leading-tight'
export const COMPOSER_INLINE_SKILL_CHIP_CLASS_NAME =
  'inline-flex max-w-full select-none items-center gap-1 rounded-md border border-fuchsia-500/25 bg-fuchsia-500/12 px-1.5 py-px font-medium text-xs leading-tight text-fuchsia-700 align-middle dark:text-fuchsia-300'

/** Collapses the runtime's 'ready' status to 'idle' for UI purposes — the
 * composer only cares about "not currently mid-turn". */
export function normalizeStatus(status: RealtimeStatus) {
  return status === 'ready' ? 'idle' : status
}

/** Small badge icon used by skill chips both in the composer and the header
 * attachment menu — a stylized "package"/skill glyph. */
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
