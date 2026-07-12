export type SelectedThreadDocument = {
  documentId: string
  filename: string
  versionId: string | null
  versionNumber: number | null
}

/**
 * Builds turn-scoped document context for existing thread documents. The picker
 * previously had no way to name an already-uploaded document, so the runtime
 * only received new uploads or the open side-panel document. Preserve the
 * selected current version in the internal context so a later document update
 * cannot make the original selection ambiguous.
 */
export function buildSelectedDocumentsContext(
  documents: SelectedThreadDocument[],
): string {
  if (documents.length === 0) return ''

  return `The user selected these existing thread documents for this turn. Use these handles only in document tool calls. Do not mention handles, ids, or UUIDs to the user; refer to documents by filename:\n${documents
    .map(
      (document) =>
        `- handle: ${document.documentId}; filename: ${document.filename}${
          document.versionNumber ? ` (V${document.versionNumber})` : ''
        }${document.versionId ? `; selected_version: ${document.versionId}` : ''}`,
    )
    .join('\n')}`
}
