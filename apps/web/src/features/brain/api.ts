import { getApiTransport } from '@/lib/api/state'
import {
  BrainFileListResponseSchema,
  BrainFileResponseSchema,
  BrainFolderDetailResponseSchema,
  BrainFolderListResponseSchema,
  BrainFolderResponseSchema,
  type BrainFileSummary,
  type BrainFolderPrivacy,
  type BrainFolderSummary,
} from './contract'

export type { BrainFileStatus, BrainFileSummary } from './contract'
export type { BrainFolderPrivacy, BrainFolderSummary } from './contract'

export async function uploadBrainFile(
  file: File,
  onProgress?: (percentage: number) => void,
): Promise<BrainFileSummary> {
  const formData = new FormData()
  formData.set('file', file)

  const response = await getApiTransport().requestFormWithProgress<unknown>(
    '/api/brain/files',
    formData,
    onProgress,
  )

  return BrainFileResponseSchema.parse(response).item
}

export async function listBrainFiles(
  signal?: AbortSignal,
): Promise<BrainFileSummary[]> {
  const response = await getApiTransport().request<unknown>(
    '/api/brain/files',
    { signal },
  )

  return BrainFileListResponseSchema.parse(response).items
}

export async function getBrainFile(id: string): Promise<BrainFileSummary> {
  const response = await getApiTransport().request<unknown>(
    `/api/brain/files/${encodeURIComponent(id)}`,
  )

  return BrainFileResponseSchema.parse(response).item
}

/** Restarts indexing for one file in the active workspace. */
export async function retryBrainFile(id: string): Promise<BrainFileSummary> {
  const response = await getApiTransport().request<unknown>(
    `/api/brain/files/${encodeURIComponent(id)}`,
    { method: 'POST' },
  )

  return BrainFileResponseSchema.parse(response).item
}

/** Deletes one file from the workspace knowledge base (and its R2 bytes). */
export async function deleteBrainFile(id: string): Promise<void> {
  await getApiTransport().request<unknown>(
    `/api/brain/files/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
}

export type BrainFolderDetail = {
  item: BrainFolderSummary
  files: BrainFileSummary[]
}

export async function listBrainFolders(
  signal?: AbortSignal,
): Promise<BrainFolderSummary[]> {
  const response = await getApiTransport().request<unknown>(
    '/api/brain/folders',
    { signal },
  )

  return BrainFolderListResponseSchema.parse(response).items
}

export async function createBrainFolder(input: {
  name: string
  privacy: BrainFolderPrivacy
}): Promise<BrainFolderSummary> {
  const response = await getApiTransport().request<unknown>(
    '/api/brain/folders',
    { method: 'POST', body: JSON.stringify(input) },
  )

  return BrainFolderResponseSchema.parse(response).item
}

export async function updateBrainFolder(
  id: string,
  input: { name?: string; privacy?: BrainFolderPrivacy },
): Promise<BrainFolderSummary> {
  const response = await getApiTransport().request<unknown>(
    `/api/brain/folders/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  )

  return BrainFolderResponseSchema.parse(response).item
}

export async function deleteBrainFolder(id: string): Promise<void> {
  await getApiTransport().request<unknown>(
    `/api/brain/folders/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
}

export async function getBrainFolderDetail(
  id: string,
  signal?: AbortSignal,
): Promise<BrainFolderDetail> {
  const response = await getApiTransport().request<unknown>(
    `/api/brain/folders/${encodeURIComponent(id)}`,
    { signal },
  )

  return BrainFolderDetailResponseSchema.parse(response)
}

/**
 * Membership mutations return the authoritative folder detail so callers can
 * drop the result straight into the detail query cache.
 */
export async function addFileToBrainFolder(
  folderId: string,
  fileId: string,
): Promise<BrainFolderDetail> {
  const response = await getApiTransport().request<unknown>(
    `/api/brain/folders/${encodeURIComponent(folderId)}/files`,
    { method: 'POST', body: JSON.stringify({ fileId }) },
  )

  return BrainFolderDetailResponseSchema.parse(response)
}

export async function removeFileFromBrainFolder(
  folderId: string,
  fileId: string,
): Promise<BrainFolderDetail> {
  const response = await getApiTransport().request<unknown>(
    `/api/brain/folders/${encodeURIComponent(folderId)}/files`,
    { method: 'DELETE', body: JSON.stringify({ fileId }) },
  )

  return BrainFolderDetailResponseSchema.parse(response)
}

/**
 * Loads plain-text file content through the workspace-scoped content route.
 * The normal API transport expects JSON, so this narrow client keeps the same
 * credentials and active-workspace header while reading the response as text.
 */
export async function getBrainFileText(id: string): Promise<string> {
  const transport = getApiTransport()
  const workspaceId = transport.getWorkspaceId()
  const response = await fetch(
    `${transport.getBaseUrl()}/api/brain/files/${encodeURIComponent(id)}/content`,
    {
      credentials: 'include',
      headers: workspaceId ? { 'X-Workspace-ID': workspaceId } : undefined,
    },
  )

  if (response.status === 401) transport.notifyUnauthorized()
  if (!response.ok) throw new Error('Could not load file preview.')

  return response.text()
}

/**
 * Loads the text that Brain extracted from a document.
 * DOCX and XLSX previews use this text instead of loading the original bytes
 * into the browser.
 */
export async function getBrainFileExtractedText(id: string): Promise<string> {
  const transport = getApiTransport()
  const workspaceId = transport.getWorkspaceId()
  const response = await fetch(
    `${transport.getBaseUrl()}/api/brain/files/${encodeURIComponent(id)}/text`,
    {
      credentials: 'include',
      headers: workspaceId ? { 'X-Workspace-ID': workspaceId } : undefined,
    },
  )

  if (response.status === 401) transport.notifyUnauthorized()
  if (!response.ok) throw new Error('Could not load document preview.')

  return response.text()
}

/**
 * Browser-navigable URL for the content route with the download disposition.
 * Used by anchor-based downloads (file menus, folder detail), which ride the
 * session cookie instead of the fetch transport's workspace header.
 */
export function brainFileDownloadUrl(file: { id: string }) {
  return `/api/brain/files/${encodeURIComponent(file.id)}/content?download`
}

/**
 * Loads binary file content through the workspace-scoped content route.
 * PDF.js needs the original bytes instead of decoded text.
 */
export async function getBrainFileBytes(id: string): Promise<ArrayBuffer> {
  const transport = getApiTransport()
  const workspaceId = transport.getWorkspaceId()
  const response = await fetch(
    `${transport.getBaseUrl()}/api/brain/files/${encodeURIComponent(id)}/content`,
    {
      credentials: 'include',
      headers: workspaceId ? { 'X-Workspace-ID': workspaceId } : undefined,
    },
  )

  if (response.status === 401) transport.notifyUnauthorized()
  if (!response.ok) throw new Error('Could not load file preview.')

  return response.arrayBuffer()
}
