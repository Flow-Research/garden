/** X's confidential OAuth clients require Basic authentication. Executor 1.5.40
 * exposes no client-level auth-method setting and uses client_secret_post for
 * exchange and refresh (SDK chunk-7CWG3UHJ). Adapt only this endpoint; keep the
 * SDK's PKCE, state validation, encryption and refresh lifecycle intact.
 * https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code */
export const X_AUTHORIZATION_URL = 'https://x.com/i/oauth2/authorize'
export const X_TOKEN_URL = 'https://api.x.com/2/oauth2/token'

export function makeXOAuthFetch(
  baseFetch: typeof globalThis.fetch,
): typeof globalThis.fetch {
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url !== X_TOKEN_URL) return baseFetch(input, init)
    const request = new Request(input, init)
    if (request.method !== 'POST') return baseFetch(request)
    const form = new URLSearchParams(await request.text())
    const clientId = form.get('client_id')
    const secret = form.get('client_secret')
    if (!clientId || !secret) {
      return Promise.reject(
        new Error('X confidential OAuth client is not configured.'),
      )
    }
    const encode = (value: string) =>
      new URLSearchParams({ value }).toString().slice(6)
    const headers = new Headers(request.headers)
    headers.set(
      'Authorization',
      `Basic ${btoa(`${encode(clientId)}:${encode(secret)}`)}`,
    )
    form.delete('client_secret')
    return baseFetch(
      new Request(request, {
        headers,
        method: 'POST',
        body: form.toString(),
        redirect: 'error',
      }),
    )
  }
}
