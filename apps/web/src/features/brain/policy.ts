/**
 * Product policy for refreshing files uploaded in the current page session.
 * The page stops polling when those files leave the processing state.
 */
export const BRAIN_FILE_POLLING_POLICY = {
  intervalMs: 2_000,
} as const
