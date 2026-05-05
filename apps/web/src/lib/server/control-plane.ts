import { and, eq } from 'drizzle-orm'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import { formatIssueIdentifier } from '@garden/core/issues/identifier'
import { getAuthSession, toCoreUser } from '@/lib/server/session'
import type { MemberRole } from '@garden/core/types'

export function json(data: unknown, status = 200) {
  return Response.json(data, { status })
}

export function badRequest(message: string) {
  return json({ error: message }, 400)
}

export function unauthorized() {
  return json({ error: 'Unauthorized' }, 401)
}

export function forbidden(message = 'Forbidden') {
  return json({ error: message }, 403)
}

export function notFound(message = 'Not found') {
  return json({ error: message }, 404)
}

export async function requireSession(request: Request) {
  return getAuthSession(request, appEnv)
}

export async function resolveWorkspaceId(request: Request, userId: string) {
  const url = new URL(request.url)
  const candidate =
    request.headers.get('X-Workspace-ID') ??
    url.searchParams.get('workspace_id') ??
    null
  const db = getDb(appEnv)

  if (candidate) {
    const [membership] = await db
      .select()
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, candidate),
          eq(schema.member.userId, userId),
        ),
      )
    if (membership) return candidate
  }

  const [membership] = await db
    .select()
    .from(schema.member)
    .where(eq(schema.member.userId, userId))

  return membership?.organizationId ?? null
}

export async function requireWorkspaceAccess(
  request: Request,
  workspaceId: string,
) {
  const session = await requireSession(request)
  if (!session) return unauthorized()

  const db = getDb(appEnv)
  const [membership] = await db
    .select({
      organizationId: schema.member.organizationId,
      role: schema.member.role,
    })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, workspaceId),
        eq(schema.member.userId, session.user.id),
      ),
    )

  if (!membership) {
    return forbidden('Workspace access denied')
  }

  return {
    session,
    membership,
  }
}

export function toWorkspace(
  record: typeof schema.organization.$inferSelect,
  role = 'owner',
) {
  const created = record.createdAt
    ? new Date(record.createdAt).toISOString()
    : new Date().toISOString()
  return {
    id: record.id,
    name: record.name,
    slug: record.slug,
    description: record.description ?? null,
    context: record.context ?? null,
    settings:
      record.settings &&
      typeof record.settings === 'object' &&
      !Array.isArray(record.settings)
        ? record.settings
        : {},
    repos: [],
    issue_prefix: 'ACC',
    created_at: created,
    updated_at: record.updatedAt
      ? new Date(record.updatedAt).toISOString()
      : created,
    role,
  }
}

type OrganizationRecord = {
  id: string
  name: string
  slug: string
  createdAt: Date | string
  logo?: string | null
  metadata?: unknown
  description?: string | null
  context?: string | null
  settings?: unknown
  plan?: string | null
  updatedAt?: Date | string | null
}

export function toWorkspaceFromOrganization(
  record: OrganizationRecord,
  role = 'owner',
) {
  const created = new Date(record.createdAt).toISOString()
  return {
    id: record.id,
    name: record.name,
    slug: record.slug,
    description: record.description ?? null,
    context: record.context ?? null,
    settings:
      record.settings &&
      typeof record.settings === 'object' &&
      !Array.isArray(record.settings)
        ? (record.settings as Record<string, unknown>)
        : {},
    repos: [],
    issue_prefix: 'ACC',
    created_at: created,
    updated_at: record.updatedAt
      ? new Date(record.updatedAt).toISOString()
      : created,
    role,
  }
}

type InvitationRecord = {
  id: string
  organizationId: string
  inviterId: string
  email: string
  role?: string | null
  status: string
  createdAt?: Date | string | null
  expiresAt?: Date | string | null
  organizationName?: string | null
  inviterName?: string | null
  inviterEmail?: string | null
}

function toISOString(value?: Date | string | null) {
  if (!value) {
    return new Date().toISOString()
  }

  return new Date(value).toISOString()
}

function toMemberRole(role?: string | null): MemberRole {
  return role === 'owner' || role === 'admin' || role === 'member'
    ? role
    : 'member'
}

function toInvitationStatus(status: string) {
  switch (status) {
    case 'accepted':
    case 'rejected':
    case 'canceled':
      return status
    default:
      return 'pending'
  }
}

export function toInvitation(record: InvitationRecord) {
  return {
    id: record.id,
    organizationId: record.organizationId,
    inviterId: record.inviterId,
    email: record.email,
    role: toMemberRole(record.role),
    status: toInvitationStatus(record.status),
    createdAt: toISOString(record.createdAt),
    expiresAt: toISOString(record.expiresAt),
    organizationName: record.organizationName ?? undefined,
    inviterName: record.inviterName ?? undefined,
    inviterEmail: record.inviterEmail ?? undefined,
  }
}

export function toIssue(
  record: typeof schema.issue.$inferSelect,
  options: { issuePrefix?: string } = {},
) {
  const sourceSummary = record.sourceSummary
    ? {
        connector_id: 'manual',
        display_ref: record.sourceSummary,
        external_url: null,
      }
    : null
  const prefix = options.issuePrefix ?? 'ISS'

  return {
    id: record.id,
    workspace_id: record.workspaceId,
    number: record.number,
    identifier: formatIssueIdentifier(prefix, record.number),
    title: record.title,
    description: record.description ?? null,
    status: record.status,
    priority: record.priority,
    assignee_type:
      record.assigneeType === 'user' ? 'member' : record.assigneeType,
    assignee_id: record.assigneeId ?? null,
    creator_type: 'member',
    creator_id: record.createdBy,
    parent_issue_id: record.parentId ?? null,
    project_id: record.projectId ?? null,
    position: record.position,
    due_date: record.dueDate ? new Date(record.dueDate).toISOString() : null,
    active_run_id: record.activeRunId ?? null,
    source_summary: sourceSummary,
    reactions: [],
    created_at: record.createdAt
      ? new Date(record.createdAt).toISOString()
      : new Date().toISOString(),
    updated_at: record.updatedAt
      ? new Date(record.updatedAt).toISOString()
      : new Date().toISOString(),
  }
}

export function toAgent(record: typeof schema.agent.$inferSelect) {
  const created = record.createdAt
    ? new Date(record.createdAt).toISOString()
    : new Date().toISOString()
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    reports_to: record.reportsTo ?? null,
    runtime_id: '',
    name: record.name,
    description: record.roleTitle ?? '',
    instructions: record.instructions ?? '',
    avatar_url: null,
    runtime_mode: 'cloud',
    runtime_config: record.persona ? JSON.parse(record.persona) : {},
    custom_env: {},
    custom_args: [],
    custom_env_redacted: false,
    visibility: 'workspace',
    status: record.status === 'archived' ? 'offline' : 'idle',
    record_status: record.status,
    is_default: record.isDefault,
    max_concurrent_tasks: 1,
    owner_id: record.ownerUserId ?? null,
    skills: [],
    created_at: created,
    updated_at: created,
    archived_at: record.status === 'archived' ? created : null,
    archived_by: null,
  }
}

export function toChatThread(
  record: typeof schema.chatThread.$inferSelect,
  hostName: string,
  primaryIssue?: {
    id: string
    number: number
    title: string
    status: string | null
  } | null,
) {
  const createdAt = record.createdAt
    ? new Date(record.createdAt).toISOString()
    : new Date().toISOString()
  const updatedAt = record.updatedAt
    ? new Date(record.updatedAt).toISOString()
    : createdAt

  return {
    id: record.id,
    workspaceId: record.workspaceId,
    ownerUserId: record.ownerUserId,
    title: record.title,
    agentId: record.agentId,
    hostName,
    primary_issue_id: record.primaryIssueId ?? null,
    primaryIssue: primaryIssue
      ? {
          id: primaryIssue.id,
          identifier: formatIssueIdentifier('ISS', primaryIssue.number),
          title: primaryIssue.title,
          status: primaryIssue.status ?? 'backlog',
        }
      : null,
    lastMessage: record.lastMessage,
    archivedAt: record.archivedAt
      ? new Date(record.archivedAt).toISOString()
      : null,
    createdAt,
    updatedAt,
  }
}

type SkillApiFile = {
  id: string
  skill_id: string
  path: string
  content?: string
  content_hash?: string | null
  r2_key?: string | null
}

export function toSkill(
  record: typeof schema.skill.$inferSelect,
  options?: {
    files?: SkillApiFile[]
  },
) {
  const created = record.createdAt
    ? new Date(record.createdAt).toISOString()
    : new Date().toISOString()
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    slug: record.slug,
    name: record.name,
    description: record.description ?? '',
    content: record.body ?? '',
    config: record.frontmatter ? JSON.parse(record.frontmatter) : {},
    files: (options?.files ?? []).map((file) => ({
      id: file.id,
      skill_id: file.skill_id,
      path: file.path,
      content: file.content ?? '',
      content_hash: file.content_hash ?? null,
      r2_key: file.r2_key ?? null,
      created_at: created,
      updated_at: created,
    })),
    source_type:
      record.sourceType === 'skills.sh' ? 'skills.sh' : 'manual',
    source_url: record.sourceUrl ?? null,
    bundle_hash: record.bundleHash ?? null,
    created_by: record.authorId ?? null,
    created_at: created,
    updated_at: record.updatedAt
      ? new Date(record.updatedAt).toISOString()
      : created,
  }
}

export function toCoreSessionUser(
  result: NonNullable<Awaited<ReturnType<typeof getAuthSession>>>,
) {
  return toCoreUser(result.user)
}
