import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { appEnv } from '@/lib/server/env'
import { getAuthSession } from '@/lib/server/session'

export const getRouteSession = createServerFn({ method: 'GET' }).handler(
  async () => {
    const session = await getAuthSession(getRequest(), appEnv)
    if (!session) return null

    return {
      userId: session.user.id,
    }
  },
)
