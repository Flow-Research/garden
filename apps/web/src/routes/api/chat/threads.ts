import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import {
  createChatThreadBodySchema,
  parseJsonBody,
} from '@/lib/server/validation/chat'
import { ensureAgentRow } from '@/lib/server/chat-agents'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  badRequest,
  forbidden,
  requireSession,
  resolveWorkspaceId,
  toChatThread,
  unauthorized,
} from '@/lib/server/control-plane'

const NEW_CHAT_TITLE = 'New Chat'

export const Route = createFileRoute('/api/chat/threads')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()

        const workspaceId = await resolveWorkspaceId(request, session.user.id)
        if (!workspaceId) return Response.json([])

        await ensureAgentRow({
          workspaceId,
          ownerUserId: session.user.id,
        })

        const db = getDb(appEnv)
        const rows = await db
          .select({
            thread: schema.chatThread,
            hostName: schema.agent.hostName,
            primaryIssue: {
              id: schema.issue.id,
              number: schema.issue.number,
              title: schema.issue.title,
              status: schema.issue.status,
            },
          })
          .from(schema.chatThread)
          .innerJoin(
            schema.agent,
            eq(schema.agent.id, schema.chatThread.agentId),
          )
          .leftJoin(
            schema.issue,
            eq(schema.issue.id, schema.chatThread.primaryIssueId),
          )
          .where(
            and(
              eq(schema.chatThread.workspaceId, workspaceId),
              eq(schema.chatThread.ownerUserId, session.user.id),
              isNull(schema.chatThread.archivedAt),
            ),
          )
          .orderBy(desc(schema.chatThread.updatedAt))

        return Response.json(
          rows.flatMap((row) =>
            row.hostName
              ? [toChatThread(row.thread, row.hostName, row.primaryIssue)]
              : [],
          ),
        )
      },
      POST: async ({ request }) => {
        const session = await requireSession(request)
        if (!session) return unauthorized()

        const workspaceId = await resolveWorkspaceId(request, session.user.id)
        if (!workspaceId) {
          return Response.json(
            { error: 'Workspace not found' },
            { status: 404 },
          )
        }

        const bodyResult = await parseJsonBody(
          request,
          createChatThreadBodySchema,
          'Invalid chat thread payload',
        )
        if (bodyResult.isErr()) return badRequest(bodyResult.error.message)
        const body = bodyResult.value

        const requestedTitle = body.title ?? ''
        const title = requestedTitle || NEW_CHAT_TITLE
        const primaryIssueId = body.primary_issue_id ?? null
        const id = body.id ?? crypto.randomUUID()
        const runtimeKind = primaryIssueId ? 'issue_run' : 'chat'
        const runtimeKey = primaryIssueId ?? id
        const now = new Date()
        const db = getDb(appEnv)

        const defaultAgentRow = await ensureAgentRow({
          workspaceId,
          ownerUserId: session.user.id,
        })

        let primaryIssue: {
          id: string
          number: number
          title: string
          status: string | null
        } | null = null
        if (primaryIssueId) {
          const [issue] = await db
            .select({
              id: schema.issue.id,
              number: schema.issue.number,
              title: schema.issue.title,
              status: schema.issue.status,
            })
            .from(schema.issue)
            .where(
              and(
                eq(schema.issue.id, primaryIssueId),
                eq(schema.issue.workspaceId, workspaceId),
              ),
            )
            .limit(1)

          if (!issue) return forbidden('Issue access denied')
          primaryIssue = issue
        }

        let issueRuntimeAgentId: string | null = null
        if (primaryIssueId) {
          const [run] = await db
            .select({ agentId: schema.issueRun.agentId })
            .from(schema.issueRun)
            .where(
              and(
                eq(schema.issueRun.workspaceId, workspaceId),
                eq(schema.issueRun.issueId, primaryIssueId),
              ),
            )
            .orderBy(desc(schema.issueRun.createdAt))
            .limit(1)

          issueRuntimeAgentId = run?.agentId ?? null
        }

        const requestedAgentId =
          issueRuntimeAgentId ?? body.agent_id ?? defaultAgentRow.id

        const agentRow =
          requestedAgentId === defaultAgentRow.id
            ? defaultAgentRow
            : (
                await db
                  .select()
                  .from(schema.agent)
                  .where(eq(schema.agent.id, requestedAgentId))
                  .limit(1)
              )[0]

        if (!agentRow || agentRow.workspaceId !== workspaceId) {
          return forbidden('Agent access denied')
        }

        const agentRuntimeName = agentRow.hostName ?? agentRow.id
        if (!agentRow.hostName) {
          await db
            .update(schema.agent)
            .set({ hostName: agentRuntimeName })
            .where(eq(schema.agent.id, agentRow.id))
        }

        const thread = await db.transaction(async (tx) => {
          await tx.execute(sql`
            select pg_advisory_xact_lock(
              hashtext(${`${workspaceId}:${session.user.id}:${primaryIssueId ? `issue-chat:${primaryIssueId}` : `${agentRow.id}:warm-chat`}`})
            )
          `)

          if (primaryIssueId) {
            const [existingIssueThread] = await tx
              .select()
              .from(schema.chatThread)
              .where(
                and(
                  eq(schema.chatThread.workspaceId, workspaceId),
                  eq(schema.chatThread.ownerUserId, session.user.id),
                  eq(schema.chatThread.primaryIssueId, primaryIssueId),
                ),
              )
              .orderBy(desc(schema.chatThread.updatedAt))
              .limit(1)

            if (existingIssueThread) {
              const [reopenedThread] = await tx
                .update(schema.chatThread)
                .set({
                  agentId: agentRow.id,
                  archivedAt: null,
                  runtimeKind,
                  runtimeKey,
                  updatedAt: now,
                })
                .where(eq(schema.chatThread.id, existingIssueThread.id))
                .returning()

              if (reopenedThread) return reopenedThread
              return existingIssueThread
            }
          }

          const [createdThread] = await tx
            .insert(schema.chatThread)
            .values({
              id,
              workspaceId,
              ownerUserId: session.user.id,
              agentId: agentRow.id,
              title,
              lastMessage: '',
              primaryIssueId,
              runtimeKind,
              runtimeKey,
              createdAt: now,
              updatedAt: now,
            })
            .returning()

          return createdThread
        })

        return Response.json(
          toChatThread(thread, agentRuntimeName, primaryIssue),
          {
            status: 201,
          },
        )
      },
    },
  },
})
