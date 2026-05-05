import { Result, TaggedError } from 'better-result'
import { createAuth } from '@/lib/auth'
import { appEnv } from '@/lib/server/env'
import { forbidden, unauthorized } from './control-plane'

export type WorkspacePermission = Record<string, string[]>

export const workspacePermissions = {
  agentManage: { agent: ['create', 'update', 'delete'] },
  connectionManage: { connection: ['update'] },
  issueManage: { issue: ['update'] },
  permissionManage: { permission: ['approve', 'grant'] },
  skillManage: { skill: ['create', 'update', 'delete'] },
} satisfies Record<string, WorkspacePermission>

class WorkspacePermissionError extends TaggedError('WorkspacePermissionError')<{
  status: number
  message: string
}>() {}

async function hasWorkspacePermission(args: {
  request: Request
  workspaceId: string
  permissions: WorkspacePermission
}) {
  const auth = createAuth(appEnv, args.request)
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

export async function requireWorkspacePermission(args: {
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
