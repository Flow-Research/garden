import { eq } from 'drizzle-orm'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { createAuth } from '@/lib/auth'
import { toWorkspaceFromOrganization } from '@/lib/server/control-plane'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import { getAuthSession, toCoreUser } from '@/lib/server/session'
import type { User, Workspace } from '@garden/core/types'

export interface AuthBootstrap {
  user: User
  workspaces: Workspace[]
}

const rawGetAuthBootstrap = createServerFn({ method: 'GET' }).handler(
  async () => {
    const request = getRequest()
    const session = await getAuthSession(request, appEnv)
    if (!session) return null

    const db = getDb(appEnv)
    const [userRow] = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, session.user.id))
    if (!userRow) return null

    const auth = createAuth(appEnv)
    const organizations = await auth.api.listOrganizations({
      headers: request.headers,
    })

    return {
      user: toCoreUser({
        id: userRow.id,
        email: userRow.email,
        name: userRow.name,
        image: userRow.avatarUrl ?? null,
        createdAt: userRow.createdAt,
        updatedAt: userRow.updatedAt,
      }),
      // Settings is Record<string, unknown> at the type level but the values come
      // from JSONB columns — already JSON-serializable. Cast lets TanStack's
      // server-fn validator accept the response.
      workspaces: organizations.map((organization) =>
        toWorkspaceFromOrganization(organization, 'owner'),
      ) as unknown as never,
    }
  },
)

export const getAuthBootstrap: () => Promise<AuthBootstrap | null> = () =>
  rawGetAuthBootstrap() as Promise<AuthBootstrap | null>
