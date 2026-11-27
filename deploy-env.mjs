/**
 * Validates an optional credential pair before Alchemy plans any resources.
 * Effect's `Config.redacted` validates that a key resolves to a string, but it
 * does not express cross-key constraints or reject whitespace-only strings.
 * Returning `false` means both values are absent; every other invalid shape
 * fails the deployment before Cloudflare receives a Worker upload.
 */
export function optionalCredentialPairIsConfigured(
  env,
  clientId,
  clientSecret,
) {
  const values = [clientId, clientSecret].map((name) => env[name])
  const present = values.map(
    (value) => typeof value === 'string' && value.trim().length > 0,
  )
  const defined = values.map((value) => value !== undefined)

  if (defined.some(Boolean) && !present.every(Boolean)) {
    throw new Error(
      `${clientId} and ${clientSecret} must both be non-empty when configured`,
    )
  }

  return present.every(Boolean)
}
