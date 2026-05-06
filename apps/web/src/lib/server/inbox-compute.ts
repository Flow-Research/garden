import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/server/db";
import { appEnv } from "@/lib/server/env";
import type {
  InboxItem,
  InboxItemType,
  InboxSeverity,
  IssueStatus,
} from "@garden/core/types";

type IssueRow = typeof schema.issue.$inferSelect;
type CommentRow = typeof schema.issueComment.$inferSelect;
type RunRow = typeof schema.issueRun.$inferSelect;
type WorkProductRow = typeof schema.issueWorkProduct.$inferSelect;
type PermissionRequestRow = typeof schema.permissionRequest.$inferSelect;

type RunEventLite = {
  runId: string;
  eventType: string;
  message: string | null;
  payload: unknown;
};

type FailedRunEventInfo = {
  latestEvent?: RunEventLite;
  failedEvent?: RunEventLite;
  latestToolStarted?: RunEventLite;
};

type SourceItem = {
  key: string;
  type: InboxItemType;
  severity: InboxSeverity;
  issueId: string | null;
  title: string;
  body: string | null;
  issueStatus: IssueStatus | null;
  actorType: "member" | "agent" | null;
  actorId: string | null;
  activityAt: Date;
  details: Record<string, string>;
};

const TRUNCATE_BODY = 200;

function truncate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length <= TRUNCATE_BODY) return trimmed;
  return `${trimmed.slice(0, TRUNCATE_BODY - 1)}…`;
}

function pickIssueStatus(value: string | null): IssueStatus | null {
  if (!value) return null;
  return value as IssueStatus;
}

function isTerminalIssue(issue: IssueRow): boolean {
  return issue.status === "done" || issue.status === "cancelled";
}

function preferDate(...values: Array<Date | null | undefined>): Date {
  for (const value of values) {
    if (value) return value;
  }
  return new Date();
}

function indexById<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

function commentMentionsUser(mentions: unknown, userId: string): boolean {
  if (!mentions || typeof mentions !== "object") return false;
  const users = (mentions as { users?: unknown }).users;
  return Array.isArray(users) && users.includes(userId);
}

function commentMentionsUserSql(userId: string) {
  return sql`${schema.issueComment.mentions} @> ${JSON.stringify({ users: [userId] })}::jsonb`;
}

function actorFromComment(row: CommentRow): {
  actorType: "member" | "agent" | null;
  actorId: string | null;
} {
  const type =
    row.authorType === "user"
      ? "member"
      : row.authorType === "agent"
        ? "agent"
        : null;
  return { actorType: type, actorId: type ? row.authorId : null };
}

function actorFromAgentId(agentId: string | null): {
  actorType: "member" | "agent" | null;
  actorId: string | null;
} {
  if (!agentId) return { actorType: null, actorId: null };
  return { actorType: "agent", actorId: agentId };
}

function buildAssignedSource(
  issue: IssueRow,
  userId: string,
): SourceItem | null {
  if (issue.assigneeType !== "user" || issue.assigneeId !== userId) return null;
  const activityAt = preferDate(issue.updatedAt, issue.createdAt);
  return {
    key: `assigned:${issue.id}`,
    type: "issue_assigned",
    severity: "action_required",
    issueId: issue.id,
    title: `You were assigned to ${issue.title}`,
    body: truncate(issue.description),
    issueStatus: pickIssueStatus(issue.status),
    actorType: null,
    actorId: null,
    activityAt,
    details: {
      issue_number: String(issue.number),
      priority: issue.priority ?? "medium",
      status: issue.status ?? "backlog",
    },
  };
}

function buildBlockedSource(issue: IssueRow): SourceItem | null {
  if (issue.status !== "blocked") return null;
  const activityAt = preferDate(issue.updatedAt, issue.createdAt);
  const actor =
    issue.assigneeType === "agent"
      ? actorFromAgentId(issue.assigneeId)
      : { actorType: null, actorId: null };
  return {
    key: `blocked:${issue.id}`,
    type: "agent_blocked",
    severity: "action_required",
    issueId: issue.id,
    title: `${issue.title} is blocked`,
    body: truncate(issue.description),
    issueStatus: pickIssueStatus(issue.status),
    ...actor,
    activityAt,
    details: {
      issue_number: String(issue.number),
      status: issue.status ?? "blocked",
    },
  };
}

function buildMentionSource(comment: CommentRow, issue: IssueRow): SourceItem {
  const activityAt = preferDate(comment.createdAt);
  const { actorType, actorId } = actorFromComment(comment);
  return {
    key: `mention:${comment.id}`,
    type: "mentioned",
    severity: "action_required",
    issueId: issue.id,
    title: `Mentioned on ${issue.title}`,
    body: truncate(comment.body),
    issueStatus: pickIssueStatus(issue.status),
    actorType,
    actorId,
    activityAt,
    details: {
      issue_number: String(issue.number),
      comment_id: comment.id,
    },
  };
}

function buildCommentSource(comment: CommentRow, issue: IssueRow): SourceItem {
  const activityAt = preferDate(comment.createdAt);
  const { actorType, actorId } = actorFromComment(comment);
  return {
    key: `comment:${comment.id}`,
    type: "new_comment",
    severity: "attention",
    issueId: issue.id,
    title: `New comment on ${issue.title}`,
    body: truncate(comment.body),
    issueStatus: pickIssueStatus(issue.status),
    actorType,
    actorId,
    activityAt,
    details: {
      issue_number: String(issue.number),
      comment_id: comment.id,
    },
  };
}

function buildApprovalSource(
  request: PermissionRequestRow,
  issue: IssueRow | undefined,
): SourceItem | null {
  if (request.status !== "pending") return null;
  const activityAt = preferDate(request.requestedAt);
  const titleSuffix = issue ? ` on ${issue.title}` : "";
  return {
    key: `approval:${request.id}`,
    type: "review_requested",
    severity: "action_required",
    issueId: issue?.id ?? null,
    title: `Approval needed${titleSuffix}`,
    body: truncate(request.context ?? null),
    issueStatus: issue ? pickIssueStatus(issue.status) : null,
    ...actorFromAgentId(request.agentId),
    activityAt,
    details: {
      kind: "approval",
      request_id: request.id,
      ...(issue ? { issue_number: String(issue.number) } : {}),
    },
  };
}

function buildWaitingForInputSource(run: RunRow, issue: IssueRow): SourceItem {
  const activityAt = preferDate(run.updatedAt, run.startedAt, run.createdAt);
  return {
    key: `waiting_for_input:${run.id}`,
    type: "waiting_for_input",
    severity: "action_required",
    issueId: issue.id,
    title: `Garden is waiting on you on ${issue.title}`,
    body: truncate(run.error ?? null),
    issueStatus: pickIssueStatus(issue.status),
    ...actorFromAgentId(run.agentId),
    activityAt,
    details: {
      kind: "waiting_for_input",
      run_id: run.id,
      issue_number: String(issue.number),
    },
  };
}

function buildWorkProductReviewSource(
  wp: WorkProductRow,
  issue: IssueRow,
): SourceItem {
  const activityAt = preferDate(wp.updatedAt, wp.createdAt);
  const title = wp.title?.trim() || `${wp.type} ready`;
  return {
    key: `wp_review:${wp.id}`,
    type: "wp_review",
    severity: "action_required",
    issueId: issue.id,
    title: `${title} on ${issue.title}`,
    body: truncate(wp.body),
    issueStatus: pickIssueStatus(issue.status),
    ...actorFromAgentId(wp.agentId),
    activityAt,
    details: {
      kind: "wp_review",
      work_product_id: wp.id,
      work_product_type: wp.type,
      issue_number: String(issue.number),
    },
  };
}

function payloadValue(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>)[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function payloadError(payload: unknown): string | null {
  return (
    payloadValue(payload, "error") ??
    payloadValue(payload, "reason") ??
    payloadValue(payload, "message")
  );
}

function failedRunBody(run: RunRow, info: FailedRunEventInfo | undefined) {
  const latestTool = info?.latestToolStarted
    ? payloadValue(info.latestToolStarted.payload, "tool")
    : null;
  const eventError =
    payloadError(info?.failedEvent?.payload) ??
    payloadError(info?.latestEvent?.payload) ??
    info?.failedEvent?.message ??
    info?.latestEvent?.message ??
    null;
  const error = run.error?.trim() || eventError;

  if (run.error === "tool_timeout") {
    return truncate(
      latestTool
        ? `Tool timed out: ${latestTool}. The run failed because that tool did not return before the recovery deadline.`
        : "A tool timed out before returning a result.",
    );
  }

  if (error) return truncate(error);
  return "The run failed without a recorded error message.";
}

function buildFailedRunSource(
  run: RunRow,
  issue: IssueRow,
  info?: FailedRunEventInfo,
): SourceItem {
  const activityAt = preferDate(run.finishedAt, run.updatedAt, run.createdAt);
  const latestEvent = info?.latestEvent;
  const latestTool = info?.latestToolStarted
    ? payloadValue(info.latestToolStarted.payload, "tool")
    : null;
  const eventError =
    payloadError(info?.failedEvent?.payload) ??
    payloadError(latestEvent?.payload) ??
    info?.failedEvent?.message ??
    latestEvent?.message ??
    null;
  return {
    key: `failed_run:${run.id}`,
    type: "task_failed",
    severity: "attention",
    issueId: issue.id,
    title: `A run failed on ${issue.title}`,
    body: failedRunBody(run, info),
    issueStatus: pickIssueStatus(issue.status),
    ...actorFromAgentId(run.agentId),
    activityAt,
    details: {
      run_id: run.id,
      issue_number: String(issue.number),
      ...(run.error ? { error: run.error } : {}),
      ...(eventError ? { event_error: eventError } : {}),
      ...(latestEvent ? { latest_event: latestEvent.eventType } : {}),
      ...(latestTool ? { latest_tool: latestTool } : {}),
    },
  };
}

function userIsResponsible(issue: IssueRow, userId: string): boolean {
  return (
    issue.createdBy === userId ||
    (issue.assigneeType === "user" && issue.assigneeId === userId)
  );
}

type InboxCandidate = {
  key: string;
  read: boolean;
  issueStatus: IssueStatus | null;
};

type InboxPredicate = (item: InboxCandidate) => boolean;

function toInboxCandidate(
  source: SourceItem,
  dismissedAt: Date | null,
): InboxCandidate {
  return {
    key: source.key,
    read: dismissedAt
      ? dismissedAt.getTime() >= source.activityAt.getTime()
      : false,
    issueStatus: source.issueStatus,
  };
}

function toInboxItem(
  source: SourceItem,
  args: {
    workspaceId: string;
    userId: string;
    dismissedAt: Date | null;
  },
): InboxItem {
  const dismissed = args.dismissedAt
    ? args.dismissedAt.getTime() >= source.activityAt.getTime()
    : false;
  return {
    id: source.key,
    workspace_id: args.workspaceId,
    recipient_type: "member",
    recipient_id: args.userId,
    actor_type: source.actorType,
    actor_id: source.actorId,
    type: source.type,
    severity: source.severity,
    issue_id: source.issueId,
    title: source.title,
    body: source.body,
    issue_status: source.issueStatus,
    read: dismissed,
    archived: dismissed,
    created_at: source.activityAt.toISOString(),
    details: source.details,
  };
}

async function computeInboxSourceItems(args: {
  workspaceId: string;
  userId: string;
  limit?: number;
}): Promise<{
  sources: SourceItem[];
  dismissalsByKey: Map<string, Date>;
}> {
  const db = getDb(appEnv);
  const { workspaceId, userId } = args;

  const [
    workspaceIssues,
    workspaceComments,
    approvalRows,
    pendingWorkProducts,
    pausedRuns,
    failedRuns,
    succeededRuns,
    dismissalRows,
  ] = await Promise.all([
    db
      .select()
      .from(schema.issue)
      .where(eq(schema.issue.workspaceId, workspaceId)),
    db
      .select({
        id: schema.issueComment.id,
        issueId: schema.issueComment.issueId,
        authorType: schema.issueComment.authorType,
        authorId: schema.issueComment.authorId,
        body: schema.issueComment.body,
        mentions: schema.issueComment.mentions,
        createdAt: schema.issueComment.createdAt,
      })
      .from(schema.issueComment)
      .innerJoin(schema.issue, eq(schema.issue.id, schema.issueComment.issueId))
      .where(
        and(
          eq(schema.issue.workspaceId, workspaceId),
          or(
            eq(schema.issueComment.authorType, "agent"),
            and(
              eq(schema.issueComment.authorType, "user"),
              ne(schema.issueComment.authorId, userId),
            ),
          ),
          or(
            commentMentionsUserSql(userId),
            eq(schema.issue.createdBy, userId),
            and(
              eq(schema.issue.assigneeType, "user"),
              eq(schema.issue.assigneeId, userId),
            ),
          ),
        ),
      )
      .orderBy(desc(schema.issueComment.createdAt))
      .limit(300),
    db
      .select({
        id: schema.permissionRequest.id,
        agentId: schema.permissionRequest.agentId,
        kind: schema.permissionRequest.kind,
        capabilityId: schema.permissionRequest.capabilityId,
        context: schema.permissionRequest.context,
        issueId: schema.permissionRequest.issueId,
        runId: schema.permissionRequest.runId,
        argsJson: schema.permissionRequest.argsJson,
        toolCallId: schema.permissionRequest.toolCallId,
        requestedAt: schema.permissionRequest.requestedAt,
        status: schema.permissionRequest.status,
        resolvedBy: schema.permissionRequest.resolvedBy,
        resolvedAt: schema.permissionRequest.resolvedAt,
        expiresAt: schema.permissionRequest.expiresAt,
      })
      .from(schema.permissionRequest)
      .innerJoin(
        schema.agent,
        eq(schema.agent.id, schema.permissionRequest.agentId),
      )
      .where(
        and(
          eq(schema.permissionRequest.status, "pending"),
          eq(schema.agent.workspaceId, workspaceId),
        ),
      )
      .orderBy(desc(schema.permissionRequest.requestedAt))
      .limit(50),
    db
      .select()
      .from(schema.issueWorkProduct)
      .where(
        and(
          eq(schema.issueWorkProduct.workspaceId, workspaceId),
          eq(schema.issueWorkProduct.status, "review"),
          eq(schema.issueWorkProduct.reviewState, "pending"),
        ),
      )
      .orderBy(desc(schema.issueWorkProduct.updatedAt))
      .limit(100),
    db
      .select()
      .from(schema.issueRun)
      .where(
        and(
          eq(schema.issueRun.workspaceId, workspaceId),
          eq(schema.issueRun.status, "waiting_for_input"),
        ),
      )
      .orderBy(desc(schema.issueRun.updatedAt))
      .limit(100),
    db
      .select()
      .from(schema.issueRun)
      .where(
        and(
          eq(schema.issueRun.workspaceId, workspaceId),
          eq(schema.issueRun.status, "failed"),
        ),
      )
      .orderBy(desc(schema.issueRun.finishedAt))
      .limit(100),
    db
      .select()
      .from(schema.issueRun)
      .where(
        and(
          eq(schema.issueRun.workspaceId, workspaceId),
          eq(schema.issueRun.status, "succeeded"),
        ),
      )
      .orderBy(desc(schema.issueRun.finishedAt))
      .limit(100),
    db
      .select()
      .from(schema.inboxDismissal)
      .where(
        and(
          eq(schema.inboxDismissal.workspaceId, workspaceId),
          eq(schema.inboxDismissal.userId, userId),
        ),
      ),
  ]);

  const issuesById = indexById(workspaceIssues);
  const dismissalsByKey = new Map(
    dismissalRows.map((row) => [row.itemKey, row.dismissedAt ?? new Date()]),
  );

  const sources: SourceItem[] = [];
  const latestSuccessfulRunByIssueId = new Map<string, RunRow>();
  for (const run of succeededRuns) {
    const existing = latestSuccessfulRunByIssueId.get(run.issueId);
    const runAt = preferDate(run.finishedAt, run.updatedAt, run.createdAt);
    const existingAt = existing
      ? preferDate(existing.finishedAt, existing.updatedAt, existing.createdAt)
      : null;
    if (!existing || (existingAt && runAt.getTime() > existingAt.getTime())) {
      latestSuccessfulRunByIssueId.set(run.issueId, run);
    }
  }
  const latestPendingWorkProductByIssueId = new Map<string, WorkProductRow>();
  for (const wp of pendingWorkProducts) {
    const existing = latestPendingWorkProductByIssueId.get(wp.issueId);
    const wpAt = preferDate(wp.updatedAt, wp.createdAt);
    const existingAt = existing
      ? preferDate(existing.updatedAt, existing.createdAt)
      : null;
    if (!existing || (existingAt && wpAt.getTime() > existingAt.getTime())) {
      latestPendingWorkProductByIssueId.set(wp.issueId, wp);
    }
  }
  const hasNewerResolutionForIssue = (
    issueId: string,
    activityAt: Date,
  ): boolean => {
    const latestSuccessfulRun = latestSuccessfulRunByIssueId.get(issueId);
    if (
      latestSuccessfulRun &&
      preferDate(
        latestSuccessfulRun.finishedAt,
        latestSuccessfulRun.updatedAt,
        latestSuccessfulRun.createdAt,
      ).getTime() >= activityAt.getTime()
    ) {
      return true;
    }

    const latestPendingWorkProduct = latestPendingWorkProductByIssueId.get(issueId);
    return Boolean(
      latestPendingWorkProduct &&
        preferDate(
          latestPendingWorkProduct.updatedAt,
          latestPendingWorkProduct.createdAt,
        ).getTime() >= activityAt.getTime(),
    );
  };
  const failedRunIds = failedRuns.map((run) => run.id);
  const failedRunEvents =
    failedRunIds.length === 0
      ? []
      : await db
          .select({
            runId: schema.issueRunEvent.runId,
            eventType: schema.issueRunEvent.eventType,
            message: schema.issueRunEvent.message,
            payload: schema.issueRunEvent.payload,
          })
          .from(schema.issueRunEvent)
          .where(inArray(schema.issueRunEvent.runId, failedRunIds))
          .orderBy(desc(schema.issueRunEvent.createdAt), desc(schema.issueRunEvent.seq))
          .limit(failedRunIds.length * 20);
  const failedRunEventInfoByRunId = new Map<string, FailedRunEventInfo>();
  for (const event of failedRunEvents) {
    const info = failedRunEventInfoByRunId.get(event.runId) ?? {};
    if (!info.latestEvent) info.latestEvent = event;
    if (!info.failedEvent && event.eventType === "issue_run:failed") {
      info.failedEvent = event;
    }
    if (!info.latestToolStarted && event.eventType === "issue_run:tool_started") {
      info.latestToolStarted = event;
    }
    failedRunEventInfoByRunId.set(event.runId, info);
  }

  for (const issue of workspaceIssues) {
    if (isTerminalIssue(issue)) continue;
    const assigned = buildAssignedSource(issue, userId);
    if (assigned) sources.push(assigned);
    if (issue.status === "blocked" && userIsResponsible(issue, userId)) {
      const blocked = buildBlockedSource(issue);
      if (blocked) sources.push(blocked);
    }
  }

  for (const comment of workspaceComments) {
    const issue = issuesById.get(comment.issueId);
    if (!issue) continue;
    if (isTerminalIssue(issue)) continue;
    const row = comment as CommentRow;
    const commentAt = preferDate(row.createdAt);
    if (
      row.authorType === "agent" &&
      hasNewerResolutionForIssue(issue.id, commentAt)
    ) {
      continue;
    }
    if (commentMentionsUser(row.mentions, userId)) {
      sources.push(buildMentionSource(row, issue));
      continue;
    }
    if (userIsResponsible(issue, userId)) {
      sources.push(buildCommentSource(row, issue));
    }
  }

  const approvalIssueIds = approvalRows
    .map((row) => row.issueId)
    .filter((id): id is string => Boolean(id));
  const approvalIssues =
    approvalIssueIds.length === 0
      ? new Map<string, IssueRow>()
      : indexById(
          await db
            .select()
            .from(schema.issue)
            .where(
              and(
                eq(schema.issue.workspaceId, workspaceId),
                inArray(schema.issue.id, approvalIssueIds),
              ),
            ),
        );
  for (const request of approvalRows) {
    const issue = request.issueId
      ? approvalIssues.get(request.issueId)
      : undefined;
    if (request.issueId && !issue) continue;
    if (issue && isTerminalIssue(issue)) continue;
    const item = buildApprovalSource(request, issue);
    if (item) sources.push(item);
  }

  for (const wp of pendingWorkProducts) {
    const issue = issuesById.get(wp.issueId);
    if (!issue) continue;
    if (isTerminalIssue(issue)) continue;
    sources.push(buildWorkProductReviewSource(wp, issue));
  }

  for (const run of pausedRuns) {
    const issue = issuesById.get(run.issueId);
    if (!issue || !userIsResponsible(issue, userId)) continue;
    if (isTerminalIssue(issue)) continue;
    sources.push(buildWaitingForInputSource(run, issue));
  }

  for (const run of failedRuns) {
    const issue = issuesById.get(run.issueId);
    if (!issue || !userIsResponsible(issue, userId)) continue;
    if (isTerminalIssue(issue)) continue;
    const failedAt = preferDate(run.finishedAt, run.updatedAt, run.createdAt);
    const newerSuccess = latestSuccessfulRunByIssueId.get(run.issueId);
    const newerWorkProduct = latestPendingWorkProductByIssueId.get(run.issueId);
    if (
      newerSuccess &&
      preferDate(
        newerSuccess.finishedAt,
        newerSuccess.updatedAt,
        newerSuccess.createdAt,
      ).getTime() >= failedAt.getTime()
    ) {
      continue;
    }
    if (
      newerWorkProduct &&
      preferDate(newerWorkProduct.updatedAt, newerWorkProduct.createdAt).getTime() >=
        failedAt.getTime()
    ) {
      continue;
    }
    sources.push(
      buildFailedRunSource(run, issue, failedRunEventInfoByRunId.get(run.id)),
    );
  }

  return {
    sources: sources
      .sort(
        (left, right) => right.activityAt.getTime() - left.activityAt.getTime(),
      )
      .slice(0, args.limit ?? 100),
    dismissalsByKey,
  };
}

export async function computeInboxItems(args: {
  workspaceId: string;
  userId: string;
  limit?: number;
}): Promise<InboxItem[]> {
  const { workspaceId, userId } = args;
  const { sources, dismissalsByKey } = await computeInboxSourceItems(args);

  return sources
    .sort(
      (left, right) => right.activityAt.getTime() - left.activityAt.getTime(),
    )
    .map((source) =>
      toInboxItem(source, {
        workspaceId,
        userId,
        dismissedAt: dismissalsByKey.get(source.key) ?? null,
      }),
    );
}

export async function computeVisibleInboxItemKeys(args: {
  workspaceId: string;
  userId: string;
  predicate?: InboxPredicate;
}): Promise<string[]> {
  const { sources, dismissalsByKey } = await computeInboxSourceItems(args);
  return sources
    .map((source) =>
      toInboxCandidate(source, dismissalsByKey.get(source.key) ?? null),
    )
    .filter((item) => (args.predicate ? args.predicate(item) : true))
    .map((item) => item.key);
}

export async function computeInboxUnreadCount(args: {
  workspaceId: string;
  userId: string;
}): Promise<number> {
  const items = await computeInboxItems(args);
  return items.filter((item) => !item.read).length;
}
