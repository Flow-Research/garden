import { createServerFn } from '@tanstack/react-start'
import { requireAppRequestContext } from '@/lib/server/context'

/**
 * Exposes only public provider availability to auth screens. The browser needs
 * this flag to hide unusable Google controls in unconfigured local clones, but
 * it must never receive either OAuth credential. Both values must exist before
 * milestone 2 enables the server provider.
 */
export const getAuthProviderAvailability = createServerFn({
  method: 'GET',
}).handler(({ context }) => {
  const { env } = requireAppRequestContext(context)

  return {
    google: Boolean(
      env.GOOGLE_AUTH_CLIENT_ID?.trim() &&
      env.GOOGLE_AUTH_CLIENT_SECRET?.trim(),
    ),
  }
})
