import { Result, type Result as ResultValue } from 'better-result'
import type { Attachment } from '@garden/core/types'
import {
  IssueServiceError,
  connectorCommentActorLabel,
  toIssueAttachment,
} from '@garden/server/issues/server'
import type { Db } from '@/lib/server/db'
import {
  listIssueCommentRowsWithAttachments,
  listIssueRunEventsWithAgent,
} from '@/lib/server/queries/issues'

type IssueRow = {
  id: string
  createdBy: string
  createdAt: Date | null
}

/**
 * Maps a DB comment row into the timeline comment shape.
 *
 * `authorId` is nullable for connector comments (see issue_comment check
 * constraint); keep that on `actor_id` rather than inventing a sentinel string.
 */
function toTimelineComment(
  row: {
    id: string
    authorType: string
    authorId: string | null
    body: string
    metadata: unknown
    createdAt: Date | null
  },
  attachments: Attachment[] = [],
) {
  const createdAt = (row.createdAt ?? new Date()).toISOString()
  const actorType =
    row.authorType === 'user'
      ? 'member'
      : row.authorType === 'connector'
        ? 'connector'
        : row.authorType

  return {
    type: 'comment' as const,
    id: row.id,
    actor_type: actorType,
    actor_id: row.authorId,
    actor_label:
      actorType === 'connector'
        ? connectorCommentActorLabel(row.metadata)
        : null,
    content: row.body,
    parent_id: null,
    comment_type: 'comment',
    reactions: [],
    attachments,
    created_at: createdAt,
    updated_at: createdAt,
  }
}

function toTimelineRunEvent(row: {
  event: {
    id: string
    workspaceId: string
    issueId: string
    runId: string
    seq: number
    eventType: string
    stream: string
    level: string
    message: string | null
    payload: unknown
    createdAt: Date | null
  }
  agentId: string
}) {
  return {
    type: 'activity' as const,
    id: row.event.id,
    actor_type: 'agent',
    actor_id: row.agentId,
    action: row.event.eventType,
    details:
      row.event.payload &&
      typeof row.event.payload === 'object' &&
      !Array.isArray(row.event.payload)
        ? (row.event.payload as Record<string, unknown>)
        : {},
    created_at: (row.event.createdAt ?? new Date()).toISOString(),
    event: {
      id: row.event.id,
      workspace_id: row.event.workspaceId,
      issue_id: row.event.issueId,
      run_id: row.event.runId,
      seq: row.event.seq,
      event_type: row.event.eventType,
      stream: row.event.stream,
      level: row.event.level,
      message: row.event.message ?? null,
      payload:
        row.event.payload &&
        typeof row.event.payload === 'object' &&
        !Array.isArray(row.event.payload)
          ? (row.event.payload as Record<string, unknown>)
          : null,
      created_at: (row.event.createdAt ?? new Date()).toISOString(),
    },
  }
}

/**
 * Builds the issue timeline (created activity + comments + run events) for
 * `GET /api/issues/$id/timeline`.
 */
export async function getIssueTimeline(
  db: Db,
  issue: IssueRow,
): Promise<ResultValue<unknown[], IssueServiceError>> {
  return await Result.tryPromise({
    try: async () => {
      const { comments, attachments } =
        await listIssueCommentRowsWithAttachments(db, issue.id)
      const mappedAttachments = attachments.map(toIssueAttachment)
      const attachmentsByCommentId = new Map(
        comments.map((comment) => [
          comment.id,
          mappedAttachments.filter(
            (attachment) => attachment.comment_id === comment.id,
          ),
        ]),
      )
      const runEvents = await listIssueRunEventsWithAgent(db, issue.id)

      return [
        {
          type: 'activity',
          id: `created:${issue.id}`,
          actor_type: 'member',
          actor_id: issue.createdBy,
          action: 'created',
          details: {},
          created_at: (issue.createdAt ?? new Date()).toISOString(),
        },
        ...comments.map((comment) =>
          toTimelineComment(
            comment,
            attachmentsByCommentId.get(comment.id) ?? [],
          ),
        ),
        ...runEvents.map(toTimelineRunEvent),
      ].sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      )
    },
    catch: (cause) =>
      new IssueServiceError({
        code: 'db_error',
        message: 'list issue timeline failed',
        cause,
      }),
  })
}
