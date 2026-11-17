import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { createLogger } from '@garden/observability/console'
import { seedBuiltinSkills } from '@/lib/server/builtin-skills'
import type { Db } from '@/lib/server/db'
import { applyGardenWorkspaceDefaults } from '@/lib/server/queries/workspaces/create-defaults'

const logger = createLogger('workspace-create-service')

export class WorkspaceCreateError extends TaggedError('WorkspaceCreateError')<{
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

/**
 * Creates Garden-owned default records after Better Auth creates the workspace
 * organization and owner membership. Better Auth owns auth tables; this only
 * adds issue prefix and the default Garden agent. Built-in skill seeding is
 * best-effort so a transient R2 failure does not fail create.
 *
 * Before: lived in `routes/api/workspaces.ts`. After: create-service + queries.
 */
async function finishGardenWorkspaceCreate(input: CreateWorkspaceInput) {
  const result = await Result.tryPromise({
    try: async () =>
      await applyGardenWorkspaceDefaults(input.db, {
        name: input.name,
        slug: input.slug,
        userId: input.userId,
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
  const workspace = result.value
  if (!workspace) {
    return Result.err(
      new WorkspaceCreateError({
        message: 'Workspace was not created',
        status: 500,
      }),
    )
  }

  const seedResult = await Result.tryPromise({
    try: async () =>
      await seedBuiltinSkills(workspace.id, input.db, input.bucket),
    catch: (cause) => cause,
  })
  if (seedResult.isErr()) {
    logger.error('workspace.seed_builtin_skills_failed', {
      workspaceId: workspace.id,
      error:
        seedResult.error instanceof Error
          ? seedResult.error.message
          : String(seedResult.error),
    })
  }

  return Result.ok(workspace)
}

/**
 * Creates a workspace through Better Auth's organization API, then attaches
 * Garden domain defaults. Used by `POST /api/workspaces`.
 */
export async function createWorkspaceFromOrganizationApi(
  input: CreateWorkspaceInput & {
    auth: WorkspaceOrganizationAuth
    headers: Headers
  },
): Promise<
  ResultValue<
    NonNullable<Awaited<ReturnType<typeof applyGardenWorkspaceDefaults>>>,
    WorkspaceCreateError
  >
> {
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
