/** Canonicalizes presentation differences while keeping changed facts distinct. */
export const normalizeBrainWriteBackClaim = (claim: string): string =>
  claim.trim().toLowerCase().replace(/\s+/g, ' ')

/** Namespaces Helix's globally unique source key by workspace. */
export const brainWriteBackCanonicalKey = (
  workspaceId: string,
  claimHash: string,
): string => `${workspaceId}:${claimHash}`
