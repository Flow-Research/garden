// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Guards against the bug class the October 2026 audit found: mutating routes
 * that only checked workspace membership, letting any member do admin-only
 * work. Every route file with a POST/PUT/PATCH/DELETE handler must either
 * check a workspace permission (directly or through a helper that does) or be
 * listed below with the reason a plain member (or another check) suffices.
 * Adding a mutating route therefore forces an explicit decision.
 */

const API_DIR = fileURLToPath(new URL('.', import.meta.url))

const PERMISSION_CHECKS = [
  'requireWorkspaceMember(',
  'requireWorkspacePermission(',
  'workspacePermissions.',
  // Helpers that perform the permission check themselves.
  'setAgentStatus(',
  'updateIssueSubscription(',
]

const MEMBER_LEVEL_ROUTES: Record<string, string> = {
  '$.ts': 'Effect HttpApi host; its endpoints authorize through the WorkspaceAccess service',
  'auth/$.ts': 'Better Auth handler; it authorizes its own endpoints',
  'internal/capability-sync.ts': 'internal endpoint authenticated by the shared secret, not a user',
  'me.ts': 'the caller updates only their own profile',
  'workspaces.ts': 'any signed-in user may create a workspace',
  'workspaces/$id.ts': 'Better Auth organization API enforces the role',
  'workspaces/$id/invitations/$invitationId.ts': 'Better Auth organization API enforces the role',
  'workspaces/$id/members/$memberId.ts': 'Better Auth organization API enforces the role',
  'upload-file.ts': 'members may attach files; deletion is uploader-or-issueManage',
  'comments/$id.ts': 'members may edit or delete only their own comments',
  'comments/$id/reactions.ts': 'members may react to comments',
  'issues/$id/comments.ts': 'members may comment on issues',
  'issues/$id/reactions.ts': 'members may react to issues',
  'inbox/$id/archive.ts': "a member's own inbox",
  'inbox/$id/read.ts': "a member's own inbox",
  'inbox/archive-all-read.ts': "a member's own inbox",
  'inbox/archive-all.ts': "a member's own inbox",
  'inbox/archive-completed.ts': "a member's own inbox",
  'inbox/mark-all-read.ts': "a member's own inbox",
  'chat/threads.ts': 'chat threads are private to their owner',
  'chat/threads/$id.ts': 'chat threads are private to their owner',
  'chat/threads/$id/documents.ts': 'chat threads are private to their owner',
  'chat/threads/$id/primary-issue.ts': 'chat threads are private to their owner',
  'debug-stream.ts': "refreshes debug data for the caller's own session",
  'executor/preview.ts': 'read-only preview of a catalog integration',
  'brain/files.ts': 'members may add files to the workspace brain',
  'brain/files/$id.ts': 'members may manage workspace brain files',
  'brain/folders.ts': 'members may create brain folders',
  'brain/folders/$id.ts': 'folder privacy is enforced per creator in the query',
  'brain/folders/$id/files.ts': 'folder privacy is enforced per creator in the query',
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return routeFiles(path)
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : []
  })
}

const mutatingRoutes = routeFiles(API_DIR)
  .map((path) => ({
    route: relative(API_DIR, path).split('\\').join('/'),
    source: readFileSync(path, 'utf8'),
  }))
  .filter(({ source }) => /^\s+(POST|PUT|PATCH|DELETE):/m.test(source))

describe('API route authorization', () => {
  it('finds the mutating routes', () => {
    expect(mutatingRoutes.length).toBeGreaterThan(40)
  })

  it('checks a workspace permission or documents why a member suffices', () => {
    const unchecked = mutatingRoutes
      .filter(({ source }) =>
        PERMISSION_CHECKS.every((check) => !source.includes(check)),
      )
      .map(({ route }) => route)
      .filter((route) => !(route in MEMBER_LEVEL_ROUTES))
    expect(unchecked).toEqual([])
  })

  it('has no stale entries in the member-level list', () => {
    const existing = new Set(mutatingRoutes.map(({ route }) => route))
    const stale = Object.keys(MEMBER_LEVEL_ROUTES).filter(
      (route) => !existing.has(route),
    )
    expect(stale).toEqual([])
  })
})
