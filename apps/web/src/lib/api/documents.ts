import { getApiTransport } from './state'

export type DocumentStructureNode = {
  id: string
  title: string
  level: number
  page_number: number | null
  children: DocumentStructureNode[]
}

export type ThreadDocumentsResponse = {
  ok: boolean
  attachments?: Array<{
    id?: string
    filename?: string
    file_type?: string | null
    status?: string | null
    size_bytes?: number | null
    page_count?: number | null
    structure_tree?: DocumentStructureNode[] | null
    version_id?: string | null
    version_number?: number | null
    download_url?: string | null
    updated_at?: string | null
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

export type DocumentMetadata = {
  id: string
  filename: string
  file_type: string | null
  size_bytes: number | null
  page_count: number | null
  structure_tree: DocumentStructureNode[] | null
  status: string | null
  updated_at: string | null
}

export function getDocumentMetadata(documentId: string): Promise<{
  error?: string
  ok?: boolean
  metadata?: DocumentMetadata
}> {
  return getApiTransport().request(`/api/documents/${documentId}/metadata`)
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
