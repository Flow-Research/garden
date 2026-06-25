import type { Attachment } from '@garden/core/types'
import { getApiTransport } from './state'

export function uploadFile(
  file: File,
  opts?: { issueId?: string; commentId?: string },
): Promise<Attachment> {
  const formData = new FormData()
  formData.append('file', file)
  if (opts?.issueId) formData.append('issue_id', opts.issueId)
  if (opts?.commentId) formData.append('comment_id', opts.commentId)
  return getApiTransport().requestForm('/api/upload-file', formData)
}

export function deleteAttachment(id: string): Promise<void> {
  return getApiTransport().request(`/api/attachments/${id}`, {
    method: 'DELETE',
  })
}
