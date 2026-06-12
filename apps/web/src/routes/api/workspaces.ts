import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { Result, TaggedError } from 'better-result'
import { DEFAULT_AGENT_PERMISSIONS } from '@garden/core/agents/permissions'
import { deriveIssuePrefix } from '@garden/core/issues/identifier'
import { schema, type Db } from '@/lib/server/db'
import {
  createWorkspaceBodySchema,
  parseJsonBody,
} from '@/lib/server/validation/workspaces'
import {
  badRequest,
  requireSession,
  toWorkspace,
  toWorkspaceFromOrganization,
  unauthorized,
} from '@/lib/server/control-plane'
import { seedBuiltinSkills } from '@/lib/server/builtin-skills'

const GARDEN_DESCRIPTION =
  'Garden powers chat, can read across the workspace, and can propose new agents for specialised work.'

class WorkspaceCreateError extends TaggedError('WorkspaceCreateError')<{
  message: string
  status: number
  cause?: unknown
}>() {}

type CreateWorkspaceInput = {
  bucket: R2Bucket
  context?: string | null
  db: Db
  description?: string | null
  name: string
  slug: string
  userId: string
}

type WorkspaceOrganizationAuth = {
  api: {
    createOrganization: (args: {
      headers: Headers
      body: {
        name: string
        slug: string
        description?: string
        context?: string
      }
    }) => Promise<unknown>
  }
}

/**
 * Creates Garden-owned default records after Better Auth creates the workspace
 * organization and owner membership. Before this, the route inserted Better Auth
 * organization/member rows by hand, bypassing organization plugin hooks and
 * active-organization session handling. Better Auth's organization create API now
 * owns those auth tables; this helper only adds Garden-specific data that Better
 * Auth does not know about: issue prefix, default Garden agent, and bundled
 * skills. Reference: Better Auth organization plugin createOrganization route.
 */
async function finishGardenWorkspaceCreate(input: CreateWorkspaceInput) {
  const db = input.db
  const result = await Result.tryPromise({
    try: async () =>
      await db.transaction(async (tx) => {
        const now = new Date()
        const agentId = crypto.randomUUID()
        const [workspace] = await tx
          .update(schema.organization)
          .set({
            issuePrefix: deriveIssuePrefix(input.name),
            updatedAt: now,
          })
          .where(eq(schema.organization.slug, input.slug))
          .returning()

        if (!workspace) {
          return Result.err(
            new WorkspaceCreateError({
              message: 'Workspace was not created',
              status: 500,
            }),
          )
        }

        await tx.insert(schema.agent).values({
          id: agentId,
          workspaceId: workspace.id,
          ownerUserId: input.userId,
          name: 'Garden',
          roleTitle: GARDEN_DESCRIPTION,
          isDefault: true,
          status: 'active',
          hostName: agentId,
          permissions: DEFAULT_AGENT_PERMISSIONS,
          createdAt: now,
        })

        await seedBuiltinSkills(
          workspace.id,
          tx as unknown as Db,
          input.bucket,
        )

        return Result.ok(workspace)
      }),
    catch: (cause) =>
      cause instanceof WorkspaceCreateError
        ? cause
        : new WorkspaceCreateError({
            message: 'Failed to finish workspace setup',
            status: 500,
            cause,
          }),
  })

  if (result.isErr()) return Result.err(result.error)
  return result.value
}

/**
 * Creates a workspace through Better Auth's organization API, then attaches the
 * Garden domain defaults. This keeps the product language as "workspace" while
 * letting Better Auth own organization creation, owner membership, and active
 * organization session updates.
 */
async function createWorkspaceFromOrganizationApi(
  input: CreateWorkspaceInput & {
    auth: WorkspaceOrganizationAuth
    headers: Headers
  },
) {
  const createResult = await Result.tryPromise({
    try: async () =>
      await input.auth.api.createOrganization({
        headers: input.headers,
        body: {
          name: input.name,
          slug: input.slug,
          description: input.description ?? undefined,
          context: input.context ?? undefined,
        },
      }),
    catch: (cause) =>
      new WorkspaceCreateError({
        message: readWorkspaceCreateErrorMessage(cause),
        status: readWorkspaceCreateErrorStatus(cause),
        cause,
      }),
  })

  if (createResult.isErr()) return Result.err(createResult.error)

  return finishGardenWorkspaceCreate(input)
}

function readWorkspaceCreateErrorMessage(cause: unknown) {
  if (cause && typeof cause === 'object' && 'message' in cause) {
    const message = (cause as { message?: unknown }).message
    if (typeof message === 'string' && message.length > 0) {
      if (message.toLowerCase().includes('already exists')) {
        return 'Workspace slug already exists'
      }
      return message
    }
  }

  return 'Failed to create workspace'
}

function readWorkspaceCreateErrorStatus(cause: unknown) {
  if (cause && typeof cause === 'object' && 'status' in cause) {
    const status = (cause as { status?: unknown }).status
    if (typeof status === 'number') return status
  }

  return 500
}

export const Route = createFileRoute('/api/workspaces')({
  server: {
    handlers: {
      GET: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()
        const auth = await appContext.auth.getAuth()
        const organizations = await auth.api.listOrganizations({
          headers: request.headers,
        })
        return Response.json(
          organizations.map((organization) =>
            toWorkspaceFromOrganization(organization, 'owner'),
          ),
        )
      },
      POST: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()
        const bodyResult = await parseJsonBody(
          request,
          createWorkspaceBodySchema,
          'Invalid workspace payload',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)
        const body = bodyResult.value
        const workspaceResult = await createWorkspaceFromOrganizationApi({
          auth: await appContext.auth.getAuth(),
          headers: request.headers,
          bucket: appContext.env.FILES,
          db: await appContext.db(),
          name: body.name,
          slug: body.slug,
          description: body.description,
          context: body.context,
          userId: session.user.id,
        })
        if (workspaceResult.isErr()) {
          return Response.json(
            { error: workspaceResult.error.message },
            { status: workspaceResult.error.status },
          )
        }

        return Response.json(toWorkspace(workspaceResult.value, 'owner'), {
          status: 201,
        })
      },
    },
  },
})
