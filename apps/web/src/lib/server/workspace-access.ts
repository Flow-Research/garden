import { and, eq } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import {
  agentSkillTarget,
  SkillForbiddenError,
  SkillNotFoundError,
  SkillOperationError,
  SkillUnauthorizedError,
  workspaceChatSkillTarget,
  type SkillTarget,
} from '@garden/core/skills'
import { schema } from './db'
import { Database } from './effect-database'
import { AppRequest } from './effect-context'

export type SkillWorkspaceContext = {
  readonly workspaceId: string
  readonly userId: string
}

export interface WorkspaceAccessService {
  readonly currentOptional: () => Effect.Effect<
    SkillWorkspaceContext | null,
    SkillUnauthorizedError | SkillOperationError
  >
  readonly current: () => Effect.Effect<
    SkillWorkspaceContext,
    SkillUnauthorizedError | SkillNotFoundError | SkillOperationError
  >
  readonly require: (
    workspaceId: string,
  ) => Effect.Effect<
    SkillWorkspaceContext,
    SkillUnauthorizedError | SkillForbiddenError | SkillOperationError
  >
  readonly targetForAgent: (
    agentId: string,
  ) => Effect.Effect<
    { readonly workspace: SkillWorkspaceContext; readonly target: SkillTarget },
    | SkillUnauthorizedError
    | SkillNotFoundError
    | SkillForbiddenError
    | SkillOperationError
  >
}

export class WorkspaceAccess extends Context.Service<
  WorkspaceAccess,
  WorkspaceAccessService
>()('@garden/web/WorkspaceAccess') {}

export const workspaceAccessLayer = Layer.effect(
  WorkspaceAccess,
  Effect.gen(function* () {
    const request = yield* AppRequest
    const { db } = yield* Database

    const operation = <A>(name: string, run: () => Promise<A>) =>
      Effect.tryPromise({
        try: run,
        catch: (cause) =>
          new SkillOperationError({
            operation: name,
            message: `Failed to ${name}.`,
            cause,
          }),
      })

    const session = Effect.fn('WorkspaceAccess.session')(function* () {
      const value = yield* Effect.tryPromise({
        try: () => request.auth.getSession(),
        catch: (cause) =>
          new SkillOperationError({
            operation: 'load session',
            message: 'Failed to load the current session.',
            cause,
          }),
      })
      if (!value?.user) {
        return yield* new SkillUnauthorizedError({ message: 'Unauthorized' })
      }
      return value
    })

    const membership = Effect.fn('WorkspaceAccess.membership')(function* (
      workspaceId: string,
      userId: string,
    ) {
      const rows = yield* operation('load workspace membership', () =>
        db
          .select({ workspaceId: schema.member.organizationId })
          .from(schema.member)
          .where(
            and(
              eq(schema.member.organizationId, workspaceId),
              eq(schema.member.userId, userId),
            ),
          )
          .limit(1),
      )
      return rows[0] ?? null
    })

    const currentOptional = Effect.fn('WorkspaceAccess.currentOptional')(
      function* () {
        const activeSession = yield* session()
        const userId = activeSession.user.id
        const query = request.request.url.split('?', 2)[1] ?? ''
        const explicit =
          request.request.headers.get('X-Workspace-ID') ??
          new URLSearchParams(query).get('workspace_id')

        if (explicit && (yield* membership(explicit, userId))) {
          return { workspaceId: explicit, userId }
        }

        const active = activeSession.session.activeOrganizationId
        if (active && (yield* membership(active, userId))) {
          return { workspaceId: active, userId }
        }

        const rows = yield* operation('load first workspace membership', () =>
          db
            .select({ workspaceId: schema.member.organizationId })
            .from(schema.member)
            .where(eq(schema.member.userId, userId))
            .limit(1),
        )
        const first = rows[0]
        return first ? { workspaceId: first.workspaceId, userId } : null
      },
    )

    const current = Effect.fn('WorkspaceAccess.current')(function* () {
      const workspace = yield* currentOptional()
      if (!workspace) {
        return yield* new SkillNotFoundError({
          resource: 'workspace',
          id: '',
          message: 'Workspace not found',
        })
      }
      return workspace
    })

    const requireWorkspace = Effect.fn('WorkspaceAccess.require')(function* (
      workspaceId: string,
    ) {
      const activeSession = yield* session()
      if (!(yield* membership(workspaceId, activeSession.user.id))) {
        return yield* new SkillForbiddenError({
          message: 'Workspace access denied',
        })
      }
      return { workspaceId, userId: activeSession.user.id }
    })

    const targetForAgent = Effect.fn('WorkspaceAccess.targetForAgent')(
      function* (agentId: string) {
        const workspace = yield* current()
        const rows = yield* operation('load skill target agent', () =>
          db
            .select({
              id: schema.agent.id,
              workspaceId: schema.agent.workspaceId,
              isDefault: schema.agent.isDefault,
            })
            .from(schema.agent)
            .where(eq(schema.agent.id, agentId))
            .limit(1),
        )
        const agent = rows[0]
        if (!agent) {
          return yield* new SkillNotFoundError({
            resource: 'agent',
            id: agentId,
            message: 'Agent not found',
          })
        }
        if (agent.workspaceId !== workspace.workspaceId) {
          return yield* new SkillForbiddenError({
            message: 'Agent access denied',
          })
        }
        return {
          workspace,
          target: agent.isDefault
            ? workspaceChatSkillTarget(workspace.workspaceId)
            : agentSkillTarget(agent.id),
        }
      },
    )

    return WorkspaceAccess.of({
      currentOptional,
      current,
      require: requireWorkspace,
      targetForAgent,
    })
  }),
)
