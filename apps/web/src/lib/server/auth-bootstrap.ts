import { Result } from 'better-result'
import { eq } from 'drizzle-orm'
import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { requireAppRequestContext } from '@/lib/server/context'
import { toWorkspaceFromOrganization } from '@/lib/server/control-plane'
import { schema } from '@/lib/server/db'
import { toCoreUser } from '@/lib/server/session'
import {
  createGardenLogger,
  errorFields,
  requestFields,
} from '@garden/observability/logger'
import type { User, Workspace } from '@garden/core/types'
import { z } from 'zod'

const bootstrapLogger = createGardenLogger({
  service: 'garden-staging',
  component: 'auth-bootstrap',
})

export interface AuthBootstrap {
  preferredWorkspaceId: string | null
  user: User
  workspaces: Workspace[]
}

/**
 * Loads the authenticated shell bootstrap from request-scoped app context.
 * Garden previously recreated Better Auth from `appEnv`, so
 * `listOrganizations` could not see the signed-in request and threw
 * `Unauthorized` after login. Keeping the same auth instance for session and
 * organization reads makes the workspace landing deterministic. Reference:
 * Better Auth organization plugin and TanStack Start server context.
 */
const rawGetAuthBootstrap = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ workspaceId: z.string().optional() }))
  .handler(async ({ context, data }) => {
    const appContext = requireAppRequestContext(context)

    // Wrap the whole bootstrap so infra failures degrade to an unauthenticated
    // result instead of crashing the route. A thrown session or database lookup
    // would otherwise escape the `_authenticated` loader and white-screen the
    // workspace. Infrastructure failure resolves to `null`, which the loader
    // translates into a clean `/login` redirect. Genuine "no session" and
    // "no user" outcomes use the same result. Reference:
    // better-result `Result.tryPromise` boundary wrapping (no try/catch).
    const result = await Result.tryPromise({
      try: async () => {
        const session = await appContext.auth.getSession()
        if (!session) return null

        const db = await appContext.db()
        const [userRow] = await db
          .select()
          .from(schema.user)
          .where(eq(schema.user.id, session.user.id))
        if (!userRow) return null

        const auth = await appContext.auth.getAuth()
        const organizations = await auth.api.listOrganizations({
          headers: appContext.request.headers,
        })
        // Client server-function URLs do not carry the browser route search.
        // Pass the destination explicitly so parallel invite/bootstrap requests
        // cannot leave the old active organization selected after acceptance.
        const requestedWorkspaceId = data.workspaceId ?? null
        const activeOrganizationId =
          session.session.activeOrganizationId ?? null
        const preferredWorkspaceId = resolvePreferredWorkspaceId(
          organizations,
          requestedWorkspaceId,
          activeOrganizationId,
        )

        // Persist whatever bootstrap selected when the session active org is
        // missing or stale. Before: only `?workspace_id=` deep-links called
        // setActive. After first signup / invite / a cleared active org, the
        // client hydrated list[0] while `activeOrganizationId` stayed null, so
        // the next reload could pick a different org or leave APIs without an
        // active workspace (#208). Failures degrade to bootstrap-only selection.
        if (
          preferredWorkspaceId !== null &&
          preferredWorkspaceId !== activeOrganizationId
        ) {
          const setActive = await Result.tryPromise({
            try: async () =>
              (await auth.api.setActiveOrganization({
                headers: appContext.request.headers,
                body: { organizationId: preferredWorkspaceId },
                returnHeaders: true,
              })) as { headers: Headers; response: unknown },
            catch: (cause) => cause,
          })
          if (Result.isOk(setActive)) {
            // Forward the refreshed session cookie — server-side auth.api calls don't reach the browser's cookie jar on their own.
            const cookies = setActive.value.headers.getSetCookie()
            if (cookies.length > 0) setResponseHeader('set-cookie', cookies)
          } else {
            bootstrapLogger.warn('auth.bootstrap.set_active_failed', {
              ...requestFields(appContext.request),
              ...errorFields(setActive.error),
            })
          }
        }

        return {
          preferredWorkspaceId,
          user: toCoreUser({
            id: userRow.id,
            email: userRow.email,
            name: userRow.name,
            image: userRow.avatarUrl ?? null,
            createdAt: userRow.createdAt,
            updatedAt: userRow.updatedAt,
          }),
          // Settings is Record<string, unknown> at the type level but the values
          // come from JSONB columns — already JSON-serializable. Cast lets
          // TanStack's server-fn validator accept the response.
          workspaces: organizations.map((organization) =>
            toWorkspaceFromOrganization(organization, 'owner'),
          ) as unknown as never,
        }
      },
      catch: (cause) => cause,
    })

    if (result.isErr()) {
      bootstrapLogger.warn('auth.bootstrap.degraded', {
        ...requestFields(appContext.request),
        ...errorFields(result.error),
      })
      return null
    }

    return result.value
  })

/**
 * Chooses which workspace the authenticated shell should open.
 *
 * Order: explicit `workspace_id` query (invite/deep-link) → session active org
 * → first membership. Returning null when the user has orgs left the UI to
 * guess via client hydrate while the session stayed without an active org
 * (#208). The first-membership fallback is deterministic for that load and is
 * then persisted by the bootstrap setActive path.
 */
export function resolvePreferredWorkspaceId(
  organizations: Array<{ id: string }>,
  requestedWorkspaceId: string | null,
  activeOrganizationId: string | null,
) {
  if (
    requestedWorkspaceId &&
    organizations.some(
      (organization) => organization.id === requestedWorkspaceId,
    )
  ) {
    return requestedWorkspaceId
  }

  if (
    activeOrganizationId &&
    organizations.some(
      (organization) => organization.id === activeOrganizationId,
    )
  ) {
    return activeOrganizationId
  }

  return organizations[0]?.id ?? null
}

export const getAuthBootstrap: (
  workspaceId?: string,
) => Promise<AuthBootstrap | null> = (workspaceId) =>
  rawGetAuthBootstrap({
    data: { workspaceId },
  }) as Promise<AuthBootstrap | null>
