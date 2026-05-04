import { and, eq, inArray } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { decideWakeups } from '@garden/core/issues'
import type { IssueStatus } from '@garden/core/types'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import { commentBodySchema, parseJsonBody } from '@/lib/server/validation/issues'
import {
  badRequest,
  notFound,
  requireWorkspaceAccess,
} from '@/lib/server/control-plane'
import { startIssueRun } from '@/lib/server/issue-run'

const MENTION_PATTERN = /@([A-Za-z0-9._-]+)/g
const ACTIVE_RUN_STATUSES = [
  'queued',
  'running',
  'waiting_for_input',
  'waiting_for_approval',
] as const

function normalizeMention(value: string) {
  return value.trim().toLowerCase()
}

function mentionAliases(value: { name?: string | null; email?: string | null }) {
  const aliases = new Set<string>()
  if (value.name) {
    aliases.add(normalizeMention(value.name))
    aliases.add(normalizeMention(value.name.replace(/\s+/g, '')))
  }
  if (value.email) {
    aliases.add(normalizeMention(value.email))
    aliases.add(normalizeMention(value.email.split('@')[0] ?? ''))
  }
  aliases.delete('')
  return aliases
}

function hasMentionToken(aliases: Set<string>, tokens: Set<string>) {
  for (const alias of aliases) {
    if (tokens.has(alias)) return true
  }
  return false
}

function extractMentionTokens(content: string) {
  return new Set(
    [...content.matchAll(MENTION_PATTERN)].map((match) =>
      normalizeMention(match[1] ?? ''),
    ),
  )
}

async function resolveMentions(args: {
  db: ReturnType<typeof getDb>
  workspaceId: string
  content: string
}) {
  const tokens = extractMentionTokens(args.content)
  if (tokens.size === 0) return { agents: [] as string[], users: [] as string[] }

  const [agentRows, memberRows] = await Promise.all([
    args.db
      .select({
        id: schema.agent.id,
        name: schema.agent.name,
      })
      .from(schema.agent)
      .where(
        and(
          eq(schema.agent.workspaceId, args.workspaceId),
          inArray(schema.agent.status, ['active', 'pending_approval']),
        ),
      ),
    args.db
      .select({
        id: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
      })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
      .where(eq(schema.member.organizationId, args.workspaceId)),
  ])

  const agents = agentRows
    .filter((agent) => hasMentionToken(mentionAliases({ name: agent.name }), tokens))
    .map((agent) => agent.id)
  const users = memberRows
    .filter((member) =>
      hasMentionToken(
        mentionAliases({ name: member.name, email: member.email }),
        tokens,
      ),
    )
    .map((member) => member.id)

  return {
    agents: [...new Set(agents)],
    users: [...new Set(users)],
  }
}

function mentionsJson(mentions: { agents: string[]; users: string[] }) {
  return mentions.agents.length > 0 || mentions.users.length > 0
    ? mentions
    : null
}

function toComment(row: typeof schema.issueComment.$inferSelect) {
  const createdAt = (row.createdAt ?? new Date()).toISOString()

  return {
    id: row.id,
    issue_id: row.issueId,
    author_type: row.authorType === 'user' ? 'member' : row.authorType,
    author_id: row.authorId,
    content: row.body,
    type: 'comment',
    parent_id: null,
    reactions: [],
    attachments: [],
    created_at: createdAt,
    updated_at: createdAt,
  }
}

export const Route = createFileRoute('/api/issues/$id/comments')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const db = getDb(appEnv)
        const [existingIssue] = await db
          .select({ workspaceId: schema.issue.workspaceId })
          .from(schema.issue)
          .where(eq(schema.issue.id, params.id))
        if (!existingIssue) return notFound('Issue not found')

        const access = await requireWorkspaceAccess(
          request,
          existingIssue.workspaceId,
        )
        if (access instanceof Response) return access

        const comments = await db
          .select()
          .from(schema.issueComment)
          .where(eq(schema.issueComment.issueId, params.id))

        return Response.json(comments.map(toComment))
      },
      POST: async ({ request, params }) => {
        const bodyResult = await parseJsonBody(
          request,
          commentBodySchema,
          'Comment content is required',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)
        const body = bodyResult.value

        const db = getDb(appEnv)
        const [existingIssue] = await db
          .select({
            id: schema.issue.id,
            workspaceId: schema.issue.workspaceId,
            status: schema.issue.status,
            assigneeType: schema.issue.assigneeType,
            assigneeId: schema.issue.assigneeId,
          })
          .from(schema.issue)
          .where(eq(schema.issue.id, params.id))
        if (!existingIssue) return notFound('Issue not found')

        const access = await requireWorkspaceAccess(
          request,
          existingIssue.workspaceId,
        )
        if (access instanceof Response) return access

        const mentions = await resolveMentions({
          db,
          workspaceId: existingIssue.workspaceId,
          content: body.content,
        })
        const [comment] = await db
          .insert(schema.issueComment)
          .values({
            id: crypto.randomUUID(),
            issueId: params.id,
            authorType: 'user',
            authorId: access.session.user.id,
            body: body.content,
            mentions: mentionsJson(mentions),
          })
          .returning()

        const [parentComment] = body.parent_id
          ? await db
              .select({
                authorType: schema.issueComment.authorType,
                authorId: schema.issueComment.authorId,
              })
              .from(schema.issueComment)
              .where(
                and(
                  eq(schema.issueComment.id, body.parent_id),
                  eq(schema.issueComment.issueId, params.id),
                ),
              )
              .limit(1)
          : []
        const [pendingWakeups, runningRuns] = await Promise.all([
          db
            .select({ agentId: schema.issueWakeup.agentId })
            .from(schema.issueWakeup)
            .where(
              and(
                eq(schema.issueWakeup.issueId, params.id),
                inArray(schema.issueWakeup.status, ['pending', 'claimed']),
              ),
            ),
          db
            .select({ agentId: schema.issueRun.agentId })
            .from(schema.issueRun)
            .where(
              and(
                eq(schema.issueRun.issueId, params.id),
                inArray(schema.issueRun.status, ACTIVE_RUN_STATUSES),
              ),
            ),
        ])
        const decisions = decideWakeups({
          issue: {
            id: existingIssue.id,
            status: (existingIssue.status ?? 'backlog') as IssueStatus,
            assigneeType:
              existingIssue.assigneeType === 'agent'
                ? 'agent'
                : existingIssue.assigneeType === 'user'
                  ? 'member'
                  : null,
            assigneeId: existingIssue.assigneeId,
          },
          comment: {
            id: comment.id,
            authorType: comment.authorType === 'agent' ? 'agent' : 'user',
            authorId: comment.authorId,
            body: comment.body,
            parentId: body.parent_id ?? null,
          },
          parentComment: parentComment
            ? {
                authorType:
                  parentComment.authorType === 'agent' ? 'agent' : 'user',
                authorId: parentComment.authorId,
              }
            : null,
          pendingWakeups,
          runningRuns,
          mentionedAgentIds: mentions.agents,
        })
        for (const decision of decisions) {
          if (decision.kind !== 'enqueue') continue
          const startResult = await startIssueRun(appEnv, {
            workspaceId: existingIssue.workspaceId,
            issueId: existingIssue.id,
            agentId: decision.agentId,
            source: decision.source,
            trigger: { commentId: comment.id },
            actor: { type: 'member', id: access.session.user.id },
          })
          if (startResult.isErr()) console.error(startResult.error.message)
        }

        return Response.json(toComment(comment), { status: 201 })
      },
    },
  },
})
