import { z } from 'zod'

export const BrainFileStatusSchema = z.enum(['processing', 'ready', 'failed'])

export const BrainFileSummarySchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().min(1),
    status: BrainFileStatusSchema,
    /** ISO upload time from the item's origin; feeds "Date/Time uploaded". */
    uploadedAt: z.iso.datetime().optional(),
    /** Byte size of the staged upload; feeds the Size column / folder totals. */
    sizeBytes: z.number().int().nonnegative().optional(),
    /** Display name of the uploading member; feeds "Made by …" on cards. */
    createdByName: z.string().min(1).optional(),
  })
  .strict()

export const BrainFileResponseSchema = z
  .object({ item: BrainFileSummarySchema })
  .strict()

export const BrainFileListResponseSchema = z
  .object({ items: z.array(BrainFileSummarySchema) })
  .strict()

export const BrainFileIdSchema = z.string().trim().min(1)

export type BrainFileStatus = z.infer<typeof BrainFileStatusSchema>
export type BrainFileSummary = z.infer<typeof BrainFileSummarySchema>

/** Maps persisted indexing fields to the public file status. */
export function brainFileStatusOf(item: {
  indexed: boolean
  indexStatus?: BrainFileStatus
}): BrainFileStatus {
  return item.indexStatus ?? (item.indexed ? 'ready' : 'processing')
}

/**
 * Folders (Penpot "Files & Folders [DEV READY]") are Garden-owned records in
 * Postgres — Helix has no folder concept, so folder rows reference brain file
 * item ids as plain strings. `createdByName` is denormalized for card display
 * ("Made by …"); `fileCount` feeds both the card meta row and the detail
 * header ("2 files").
 */
export const BrainFolderPrivacySchema = z.enum(['private', 'shared'])

export const BrainFolderSummarySchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().min(1),
    privacy: BrainFolderPrivacySchema,
    fileCount: z.number().int().nonnegative(),
    createdByName: z.string().min(1),
    createdAt: z.iso.datetime(),
  })
  .strict()

export const BrainFolderResponseSchema = z
  .object({ item: BrainFolderSummarySchema })
  .strict()

export const BrainFolderListResponseSchema = z
  .object({ items: z.array(BrainFolderSummarySchema) })
  .strict()

export const BrainFolderDetailResponseSchema = z
  .object({
    item: BrainFolderSummarySchema,
    files: z.array(BrainFileSummarySchema),
  })
  .strict()

/** Design limit: the create-folder dialog shows a "n/50" character counter. */
export const BRAIN_FOLDER_NAME_MAX = 50

/**
 * File-picker filter shared by the page dropzone and the create-folder
 * dialog's "Add file to folder" zone so both accept the same Brain types.
 */
export const BRAIN_ACCEPTED_FILE_TYPES = '.txt,.md,.pdf,.docx,.xlsx,.csv'

export const BrainFolderCreateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(BRAIN_FOLDER_NAME_MAX),
    privacy: BrainFolderPrivacySchema,
  })
  .strict()

export const BrainFolderUpdateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(BRAIN_FOLDER_NAME_MAX).optional(),
    privacy: BrainFolderPrivacySchema.optional(),
  })
  .strict()
  .refine((input) => input.name !== undefined || input.privacy !== undefined, {
    message: 'Nothing to update',
  })

export const BrainFolderFileInputSchema = z
  .object({ fileId: BrainFileIdSchema })
  .strict()

export type BrainFolderPrivacy = z.infer<typeof BrainFolderPrivacySchema>
export type BrainFolderSummary = z.infer<typeof BrainFolderSummarySchema>
