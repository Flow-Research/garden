import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import {
  createChatThreadBodySchema,
  parseJsonBody,
} from '@/lib/server/validation/chat'
import { ensureAgentRow } from '@/lib/server/chat-agents'
import { requireAppRequestContext } from '@/lib/server/context'
import { schema } from '@/lib/server/db'
import {
  badRequest,
  forbidden,
  requireSession,
  resolveWorkspaceId,
  toChatThread,
  unauthorized,
} from '@/lib/server/control-plane'
import { GARDEN_ANALYTICS_EVENTS } from '@garden/observability/analytics/events'
import { capturePostHogEvent } from '@/lib/posthog-server'

const NEW_CHAT_TITLE = 'New Chat'

export const Route = createFileRoute('/api/chat/threads')({
  server: {
    handlers: {
      GET: async ({ context }) => {
        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()

        const workspaceId = await resolveWorkspaceId(
          appContext,
          session.user.id,
        )
        if (!workspaceId) return Response.json([])

        const db = await appContext.db()
        await ensureAgentRow({
          db,
          workspaceId,
          ownerUserId: session.user.id,
        })
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
          rows.flatMap((row) => {
            if (!row.hostName) return []
            const thread = toChatThread(
              row.thread,
              row.hostName,
              row.primaryIssue,
            )
            if (
              thread.title.trim().toLowerCase() !== NEW_CHAT_TITLE.toLowerCase()
            ) {
              return [thread]
            }
            if (!thread.primary_issue_id && thread.runtime_kind === 'chat') {
              return [thread]
            }
            return [
              {
                ...thread,
                title: row.primaryIssue?.title ?? 'Issue chat',
              },
            ]
          }),
        )
      },
      POST: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const session = await requireSession(appContext)
        if (!session) return unauthorized()

        const workspaceId = await resolveWorkspaceId(
          appContext,
          session.user.id,
        )
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
        const db = await appContext.db()

        const defaultAgentRow = await ensureAgentRow({
          db,
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

        const threadResult = await db.transaction(async (tx) => {
          await tx.execute(sql`
            select pg_advisory_xact_lock(
              hashtext(${`${workspaceId}:${session.user.id}:${primaryIssueId ? `issue-chat:${primaryIssueId}` : `${agentRow.id}:warm-chat`}`})
            )
          `)

          if (primaryIssueId && !body.id) {
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
                  title,
                  archivedAt: null,
                  runtimeKind,
                  runtimeKey,
                  updatedAt: now,
                })
                .where(eq(schema.chatThread.id, existingIssueThread.id))
                .returning()

              return {
                thread: reopenedThread ?? existingIssueThread,
                transition: 'reopened' as const,
              }
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

          return { thread: createdThread, transition: 'created' as const }
        })

        capturePostHogEvent(appContext, {
          distinctId: session.user.id,
          event:
            threadResult.transition === 'created'
              ? GARDEN_ANALYTICS_EVENTS.chatThreadCreated
              : GARDEN_ANALYTICS_EVENTS.chatThreadReopened,
          workspaceId,
          properties: {
            thread_id: threadResult.thread.id,
            agent_id: agentRow.id,
            runtime_kind: runtimeKind,
            primary_issue_id: primaryIssueId,
            has_primary_issue: !!primaryIssueId,
          },
        })
        return Response.json(
          toChatThread(threadResult.thread, agentRuntimeName, primaryIssue),
          {
            status: 201,
          },
        )
      },
    },
  },
})
