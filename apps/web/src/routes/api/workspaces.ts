import { eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { Result, TaggedError } from 'better-result'
import { DEFAULT_AGENT_PERMISSIONS } from '@garden/core/agents/permissions'
import { deriveIssuePrefix } from '@garden/core/issues/identifier'
import { appEnv } from '@/lib/server/env'
import { createAuth } from '@/lib/auth'
import { getDb, schema } from '@/lib/server/db'
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
  context?: string | null
  description?: string | null
  name: string
  sessionId: string
  slug: string
  userId: string
}

async function createWorkspaceWithGarden(input: CreateWorkspaceInput) {
  const db = getDb(appEnv)
  const transactionResult = await Result.tryPromise({
    try: async () =>
      await db.transaction(async (tx) => {
        const [existingWorkspace] = await tx
          .select({ id: schema.organization.id })
          .from(schema.organization)
          .where(eq(schema.organization.slug, input.slug))
          .limit(1)

        if (existingWorkspace) {
          return Result.err(
            new WorkspaceCreateError({
              message: 'Workspace slug already exists',
              status: 400,
            }),
          )
        }

        const now = new Date()
        const workspaceId = crypto.randomUUID()
        const agentId = crypto.randomUUID()
        const [workspace] = await tx
          .insert(schema.organization)
          .values({
            id: workspaceId,
            name: input.name,
            slug: input.slug,
            issuePrefix: deriveIssuePrefix(input.name),
            description: input.description ?? null,
            context: input.context ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .returning()

        await tx.insert(schema.member).values({
          id: crypto.randomUUID(),
          organizationId: workspaceId,
          userId: input.userId,
          role: 'owner',
          createdAt: now,
        })

        await tx.insert(schema.agent).values({
          id: agentId,
          workspaceId,
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
          workspaceId,
          tx as unknown as ReturnType<typeof getDb>,
          appEnv.FILES,
        )

        await tx
          .update(schema.session)
          .set({
            activeOrganizationId: workspaceId,
            updatedAt: now,
          })
          .where(eq(schema.session.id, input.sessionId))

        return Result.ok(workspace!)
      }),
    catch: (cause) =>
      cause instanceof WorkspaceCreateError
        ? cause
        : new WorkspaceCreateError({
            message: 'Failed to create workspace',
            status: 500,
            cause,
          }),
  })

  if (transactionResult.isErr()) return Result.err(transactionResult.error)
  return transactionResult.value
}

export const Route = createFileRoute('/api/workspaces')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()
        const auth = createAuth(appEnv, request)
        const organizations = await auth.api.listOrganizations({
          headers: request.headers,
        })
        return Response.json(
          organizations.map((organization) =>
            toWorkspaceFromOrganization(organization, 'owner'),
          ),
        )
      },
      POST: async ({ request }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()
        const bodyResult = await parseJsonBody(
          request,
          createWorkspaceBodySchema,
          'Invalid workspace payload',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)
        const body = bodyResult.value
        const workspaceResult = await createWorkspaceWithGarden({
          name: body.name,
          slug: body.slug,
          description: body.description,
          context: body.context,
          userId: session.user.id,
          sessionId: session.session.id,
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
