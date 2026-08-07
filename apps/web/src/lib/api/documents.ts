import { getApiTransport } from './state'
import type {
  DocumentOperation,
  DocumentOperationOutcome,
  DocumentSnapshot,
} from '@garden/agent-runtime/src/documents/document-artifact-model'

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

/** Stable hierarchical cache key for one canonical document artifact. */
export const documentArtifactQueryKey = (documentId: string) =>
  ['documents', documentId, 'artifact'] as const

export function getDocumentMetadata(documentId: string): Promise<{
  error?: string
  ok?: boolean
  metadata?: DocumentMetadata
}> {
  return getApiTransport().request(`/api/documents/${documentId}/metadata`)
}

/** Reads canonical editable state through the shared Effect HttpApi route. */
export function getDocumentArtifact(
  documentId: string,
): Promise<DocumentSnapshot> {
  return getApiTransport().request(
    `/api/documents/${encodeURIComponent(documentId)}/artifact`,
  )
}

/** Applies one idempotent canonical block operation through Effect HttpApi. */
export function applyDocumentArtifactOperation(args: {
  documentId: string
  operation: DocumentOperation
}): Promise<DocumentOperationOutcome> {
  return getApiTransport().request(
    `/api/documents/${encodeURIComponent(args.documentId)}/artifact`,
    {
      method: 'POST',
      body: JSON.stringify(args.operation),
    },
  )
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
