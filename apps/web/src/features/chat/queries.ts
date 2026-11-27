import { queryOptions } from '@tanstack/react-query'
import {
  decideAnalysisKeys,
  getDecideAnalysis,
  type DecideAnalysisStatus,
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

const TERMINAL_DECIDE_ANALYSIS_STATUSES = new Set<DecideAnalysisStatus>([
  'completed',
  'failed',
  'cancelled',
])

export const isDecideAnalysisTerminal = (status: DecideAnalysisStatus) =>
  TERMINAL_DECIDE_ANALYSIS_STATUSES.has(status)

/**
 * Reads one Decide run for its card, in a chat or on an automation run. It
 * polls until the run settles so the card can show Decide's latest progress
 * note, then stops; the answer itself arrives as a chat turn or as the
 * automation's output, so nothing here waits on the result.
 * A failed status request (a 404 for a run this thread does not own, say)
 * also stops polling; before, the step spun forever on it.
 */
export function decideAnalysisOptions(runId: string) {
  return queryOptions({
    queryKey: decideAnalysisKeys.run(runId),
    queryFn: () => getDecideAnalysis(runId),
    refetchInterval: (query) =>
      query.state.status === 'error' ||
      (query.state.data && isDecideAnalysisTerminal(query.state.data.status))
        ? false
        : 3000,
  })
}
