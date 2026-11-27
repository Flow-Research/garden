import { scopeKey, type BrainScope } from '@garden/brain/domain/scope'

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

/** Uses a collision-resistant digest because this value backs unique indexes. */
export const brainWriteBackClaimHash = async (
  scope: BrainScope,
  claim: string,
): Promise<string> => {
  const value = `${scopeKey(scope)}:${normalizeBrainWriteBackClaim(claim)}`
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
