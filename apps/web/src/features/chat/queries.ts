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
}
