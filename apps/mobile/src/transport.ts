/**
 * Native Cookie headers replace browser cookie handling. Preserve headers on
 * both Request and URL inputs, and add the exact native Origin at the final
 * Fetch boundary after auth plugins finish. Never forward a credential outside
 * the configured Garden origin. Physical devices must qualify redirect refusal.
 */
export function createNativeFetch(
  origin: string,
  fetcher: typeof globalThis.fetch,
  cookie?: () => Promise<string>,
): typeof globalThis.fetch {
  return async (input, init) => {
    const request = new Request(input, init)
    if (new URL(request.url).origin !== origin) {
      return new Response(null, { status: 403 })
    }
    const headers = new Headers(request.headers)
    headers.set('origin', 'garden-mobile://')
    if (cookie) headers.set('cookie', await cookie())
    return fetcher(request, { headers, redirect: 'error' })
  }
}
