/** Canonicalizes presentation differences while keeping changed facts distinct. */
export const normalizeBrainWriteBackClaim = (claim: string): string =>
  claim.trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * Identifies one run's attempt to propose one claim. The proposal table
 * enforces it per workspace across every status, so a run replayed after its
 * proposal was approved or rejected cannot insert a second row. claimHash alone
 * is only unique while pending, which lets a later run re-propose a rejected
 * claim.
 */
export const brainWriteProposalOperationKey = (
  runId: string,
  claimHash: string,
): string => `${runId}:${claimHash}`

/** Namespaces Helix's globally unique source key by workspace. */
export const brainWriteBackCanonicalKey = (
  workspaceId: string,
  claimHash: string,
): string => `${workspaceId}:${claimHash}`
