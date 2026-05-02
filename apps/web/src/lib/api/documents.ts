import { getApiTransport } from './state'

export type ThreadDocumentsResponse = {
  ok: boolean
  attachments?: Array<{
    id?: string
    filename?: string
    file_type?: string | null
    status?: string | null
    version_id?: string | null
    version_number?: number | null
    download_url?: string | null
  }>
  error?: string
}

export type DocumentVersionItem = {
  created_at?: string | null
  display_name?: string | null
  id: string
  source?: string | null
  version_number?: number | null
}

export function listThreadDocuments(
  threadId: string,
): Promise<ThreadDocumentsResponse> {
  return getApiTransport().request(`/api/chat/threads/${threadId}/documents`)
}

export function uploadThreadDocument(args: {
  file: File
  threadId: string
}): Promise<{
  document_id?: string
  error?: string
  filename?: string
  ok?: boolean
  version_number?: number | null
}> {
  const form = new FormData()
  form.set('file', args.file)
  return getApiTransport().requestForm(
    `/api/chat/threads/${args.threadId}/documents`,
    form,
  )
}

export function listDocumentVersions(documentId: string): Promise<{
  current_version_id?: string | null
  error?: string
  ok?: boolean
  versions?: DocumentVersionItem[]
}> {
  return getApiTransport().request(`/api/documents/${documentId}/versions`)
}

export function resolveDocumentEdit(args: {
  action: 'accept' | 'reject'
  documentId: string
  editId: string
}): Promise<unknown> {
  return getApiTransport().request(
    `/api/documents/${args.documentId}/edits/${args.editId}/${args.action}`,
    { method: 'POST' },
  )
}
