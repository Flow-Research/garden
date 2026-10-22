import { Result, TaggedError } from 'better-result'
import { createAuth } from '@/lib/auth'
import { appEnv } from '@/lib/server/env'
import type { AppRequestContext } from '@/lib/server/context'
import {
  forbidden,
  requireWorkspaceAccess,
  unauthorized,
} from './control-plane'

export type WorkspacePermission = Record<string, string[]>

export const workspacePermissions = {
  agentManage: { agent: ['create', 'update', 'delete'] },
  // Automations make agents act on a schedule, so they are governed by agent
  // management until they get their own access-control statement.
  automationManage: { agent: ['create', 'update', 'delete'] },
  connectionManage: { connection: ['update'] },
  issueManage: { issue: ['update'] },
  invitationManage: { invitation: ['create', 'cancel'] },
  permissionManage: { permission: ['approve', 'grant'] },
  skillManage: { skill: ['create', 'update', 'delete'] },
  teamManage: { team: ['create', 'update', 'delete'] },
} satisfies Record<string, WorkspacePermission>

class WorkspacePermissionError extends TaggedError('WorkspacePermissionError')<{
  status: number
  message: string
}>() {}

async function hasWorkspacePermission(args: {
  appContext?: AppRequestContext
  request: Request
  workspaceId: string
  permissions: WorkspacePermission
}) {
  const auth = args.appContext
    ? await args.appContext.auth.getAuth()
    : await createAuth(appEnv, args.request)
  const result = await Result.tryPromise({
    try: async () =>
      auth.api.hasPermission({
        headers: args.request.headers,
        body: {
          organizationId: args.workspaceId,
          permissions: args.permissions,
        },
      }),
    catch: () =>
      new WorkspacePermissionError({
        status: 401,
        message: 'Unauthorized',
      }),
  })
  if (result.isErr()) return Result.err(result.error)

  return Result.ok(Boolean(result.value.success))
}

/**
 * Requires the caller to be a member of the workspace and, when given, to
 * hold `permissions` there. Returns the membership access or the 401/403
 * Response to send. Prefer this over pairing requireWorkspaceAccess with
 * requireWorkspacePermission by hand.
 */
export async function requireWorkspaceMember(
  appContext: AppRequestContext,
  workspaceId: string,
  permissions?: WorkspacePermission,
) {
  const access = await requireWorkspaceAccess(appContext, workspaceId)
  if (access instanceof Response || !permissions) return access

  const denied = await requireWorkspacePermission({
    appContext,
    request: appContext.request,
    workspaceId,
    permissions,
  })
  return denied ?? access
}

export async function requireWorkspacePermission(args: {
  appContext?: AppRequestContext
  request: Request
  workspaceId: string
  permissions: WorkspacePermission
}) {
  const allowedResult = await hasWorkspacePermission(args)
  if (allowedResult.isErr()) {
    return unauthorized()
  }

  return allowedResult.value ? null : forbidden()
}
