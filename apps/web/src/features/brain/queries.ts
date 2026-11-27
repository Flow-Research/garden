import { queryOptions } from '@tanstack/react-query'
import {
  getBrainFileText,
  getBrainFileBytes,
  getBrainFileExtractedText,
  getBrainFolderDetail,
  listBrainFiles,
  listBrainFolders,
} from './api'
import { BRAIN_FILE_POLLING_POLICY } from './policy'

/**
 * Brain cache keys. List keys are workspace-scoped — the shell navigates away
 * from /files on workspace switch, so a ws-less key rendered the previous
 * workspace's cached list while the refetch trailed (observed 2026-09).
 * Keying by wsId makes separation structural and keeps per-workspace caches
 * warm. Detail/content keys stay id-keyed: ids are globally unique and only
 * reachable through the ws-scoped lists.
 */
export const brainFileKeys = {
  all: ['brain', 'files'] as const,
  list: (wsId: string | null) => [...brainFileKeys.all, 'list', wsId] as const,
  detail: (id: string) => [...brainFileKeys.all, id] as const,
  content: (id: string) => [...brainFileKeys.detail(id), 'content'] as const,
  extractedText: (id: string) =>
    [...brainFileKeys.detail(id), 'extracted-text'] as const,
}

export const brainFolderKeys = {
  all: ['brain', 'folders'] as const,
  list: (wsId: string | null) =>
    [...brainFolderKeys.all, 'list', wsId] as const,
  detail: (id: string) => [...brainFolderKeys.all, 'detail', id] as const,
}

/**
 * Polls the workspace file list only while an upload started in this page
 * session remains in processing. Stored processing files do not start polling.
 * Polling stops after a ready result or request failure.
 */
export function brainFileListOptions(
  wsId: string | null,
  sessionUploadIds: readonly string[] = [],
) {
  const sessionUploadIdSet = new Set(sessionUploadIds)

  return queryOptions({
    queryKey: brainFileKeys.list(wsId),
    queryFn: ({ signal }) => listBrainFiles(signal),
    enabled: wsId !== null,
    retry: false,
    refetchInterval: (query) => {
      if (query.state.error !== null || sessionUploadIdSet.size === 0) {
        return false
      }

      const hasProcessingUpload = query.state.data?.some(
        (file) =>
          sessionUploadIdSet.has(file.id) && file.status === 'processing',
      )

      return hasProcessingUpload ? BRAIN_FILE_POLLING_POLICY.intervalMs : false
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })
}

export function brainFileTextOptions(id: string) {
  return queryOptions({
    queryKey: brainFileKeys.content(id),
    queryFn: () => getBrainFileText(id),
    staleTime: Infinity,
  })
}

export function brainFileExtractedTextOptions(id: string) {
  return queryOptions({
    queryKey: brainFileKeys.extractedText(id),
    queryFn: () => getBrainFileExtractedText(id),
    staleTime: Infinity,
  })
}

/** Folder list for the Files page; folder detail feeds the folder view. */
export function brainFolderListOptions(wsId: string | null) {
  return queryOptions({
    queryKey: brainFolderKeys.list(wsId),
    queryFn: ({ signal }) => listBrainFolders(signal),
    enabled: wsId !== null,
    retry: false,
    refetchOnWindowFocus: true,
  })
}

export function brainFolderDetailOptions(id: string) {
  return queryOptions({
    queryKey: brainFolderKeys.detail(id),
    queryFn: ({ signal }) => getBrainFolderDetail(id, signal),
    retry: false,
  })
}

/**
 * Loads the private PDF bytes and creates one cached PDF.js document.
 * Page previews reuse this document instead of downloading the file again.
 */
export function brainFilePdfOptions(id: string) {
  return queryOptions({
    queryKey: [...brainFileKeys.content(id), 'pdf'] as const,
    queryFn: async () => {
      const [bytes, pdfjs] = await Promise.all([
        getBrainFileBytes(id),
        import('pdfjs-dist'),
      ])

      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).toString()

      return pdfjs.getDocument({ data: bytes }).promise
    },
    staleTime: Infinity,
  })
}
