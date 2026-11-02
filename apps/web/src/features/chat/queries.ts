import { queryOptions } from '@tanstack/react-query'
import {
  chatKeys,
  getChatDecideAnalysis,
  type ChatDecideAnalysisStatus,
} from '@/lib/api'

/**
 * Query keys for chat threads and the documents attached to them. Every
 * reader, optimistic writer and invalidation goes through these so the
 * cache entries can't drift apart.
 */
export const chatThreadKeys = {
  all: ['chat-threads'] as const,
  /** The signed-in user's threads in a workspace. */
  list: (workspaceId: string | null, userId: string | null) =>
    [...chatThreadKeys.all, workspaceId, userId] as const,
  /** Document attachments uploaded into one thread. */
  documents: (threadId: string) => ['chat-thread-documents', threadId] as const,
}

/** Query keys for a document artifact opened in the chat side panel. */
export const chatDocumentKeys = {
  versions: (documentId: string | null | undefined) =>
    ['document-versions', documentId] as const,
  metadata: (documentId: string | null | undefined) =>
    ['document-metadata', documentId] as const,
  text: (url: string) => ['document-text', url] as const,
}

const TERMINAL_DECIDE_ANALYSIS_STATUSES = new Set<ChatDecideAnalysisStatus>([
  'completed',
  'failed',
  'cancelled',
])

export const isDecideAnalysisTerminal = (status: ChatDecideAnalysisStatus) =>
  TERMINAL_DECIDE_ANALYSIS_STATUSES.has(status)

/**
 * Reads one Decide run for the chat step. It polls until the run settles so
 * the step can show Decide's latest progress note, then stops; the answer
 * itself arrives as a chat turn, so nothing here waits on the result.
 */
export function decideAnalysisOptions(threadId: string, runId: string) {
  return queryOptions({
    queryKey: chatKeys.decideAnalysis(threadId, runId),
    queryFn: () => getChatDecideAnalysis(threadId, runId),
    refetchInterval: (query) =>
      query.state.data && isDecideAnalysisTerminal(query.state.data.status)
        ? false
        : 3000,
  })
}
