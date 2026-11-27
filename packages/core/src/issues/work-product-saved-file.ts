import { z } from 'zod'

/**
 * The Files & Folders file an approved document work product was saved to.
 * Approval writes it under `payload.saved_file`, a later approval overwrites
 * that same file, and the work-product card reads it back to link and
 * download the file. It lives in `payload` rather than `applied_external_*`
 * because saving is a copy, not an apply: those columns stay free for Apply
 * and Apply as PR. `url` is the file's content route.
 */
export const workProductSavedFileSchema = z
  .object({
    file_id: z.string().min(1),
    file_name: z.string().min(1),
    folder_id: z.uuid(),
    url: z.string().startsWith('/api/brain/files/'),
    saved_by: z.string().min(1),
    saved_at: z.iso.datetime(),
  })
  .strict()

export type WorkProductSavedFile = z.infer<typeof workProductSavedFileSchema>

/** Reads `payload.saved_file`; null when absent or malformed. */
export function parseWorkProductSavedFile(
  payload: unknown,
): WorkProductSavedFile | null {
  if (!payload || typeof payload !== 'object') return null
  const parsed = workProductSavedFileSchema.safeParse(
    (payload as { saved_file?: unknown }).saved_file,
  )
  return parsed.success ? parsed.data : null
}
