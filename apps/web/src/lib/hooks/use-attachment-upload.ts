import { toast } from 'sonner'
import { useFileUpload } from '@garden/app-state/hooks/use-file-upload'
import { api } from '@/lib/api'

function reportUploadError(error: Error) {
  toast.error(error.message || 'Upload failed')
}

/**
 * `useFileUpload` bound to the app API, reporting failures as a toast.
 * Without an error handler `uploadWithToast` returned null silently, so a
 * failed (or over-size) image or file just vanished from the editor.
 */
export function useAttachmentUpload() {
  return useFileUpload(api, reportUploadError)
}

/** Shown when a send is attempted while an attachment is still uploading. */
export const UPLOAD_IN_PROGRESS_MESSAGE =
  'Wait for the upload to finish before sending'
