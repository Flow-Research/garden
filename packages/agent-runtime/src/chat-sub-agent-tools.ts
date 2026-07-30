import {
  createWorkspaceStateBackend,
  type WorkspaceFsLike,
} from "@cloudflare/shell";
import { Buffer } from "node:buffer";
import { createExecuteTool } from "@cloudflare/think/tools/execute";
import type { Sandbox as SandboxDO } from "@cloudflare/sandbox";
import { Result, type Result as ResultValue } from "better-result";
import { tool, type ToolSet } from "ai";
import {
  and,
  eq,
  inArray,
  isNull,
  or,
  sql,
  type SQLWrapper,
} from "drizzle-orm";
import { getPooledDb } from "@garden/db/runtime";
import { z } from "zod";
import { connectorRegistry } from "@garden/connectors";
import { formatIssueIdentifier } from "@garden/core/issues/identifier";
import { disposeRpcResult } from "@garden/app-state/platform/rpc";
import {
  isTerminalIssueStatus,
  LIVE_RUN_STATUSES,
} from "@garden/core/issues/run-sync";
import * as schema from "@garden/db/schema";
import {
  issueCommentInsertSchema,
  issueInsertSchema,
  issueSourceBindingInsertSchema,
  issueStatusSchema,
} from "@garden/db/validation";
import {
  editDocument,
  findInDocument,
  generateDocx,
  getDocumentBytes,
  listDocuments,
  readDocument,
  registerUploadedDocument,
  type DocumentToolContext,
} from "./documents/document-tools";
import { createProposeAgentTool } from "./agent-tools/propose-agent";
import { createWebTools, type WebToolsSqlValue } from "./agent-tools/web";
import { listAvailableConnectorBindings } from "@garden/server/connectors/availability";
import { createSandboxTools } from "./sandbox-tools";
import {
  createIssue as createIssueService,
  listIssues as listIssuesService,
  postIssueComment as postIssueCommentService,
  readIssue as readIssueService,
  type IssueSummary,
} from "@garden/server/issues/server";
import {
  cancelIssueRun as cancelIssueRunService,
  startIssueRun,
  type IssueRunEnv,
} from "@garden/server/issues/run-service";
import { addIssueSubscribers } from "@garden/db/subscribers";
import { upsertIssueAssignmentInbox } from "@garden/db/inbox";
import {
  resolveWorkspaceMember,
  type WorkspaceMemberCandidate,
} from "./chat-member-resolution";
import { assignIssueInputSchema } from "./chat-assignment-schema";

type ChatSubAgentToolsInput = {
  ctx: DurableObjectState;
  exaApiKey?: string;
  databaseUrl?: string;
  threadId?: string;
  workspace: WorkspaceFsLike;
  loader: WorkerLoader;
  getSandbox: () => SandboxDO;
  issueRunEnv: IssueRunEnv;
  cancelIssueRun?: (input: { issueId: string; runId: string }) => Promise<void>;
};

const readRunStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_for_input",
  "waiting_for_approval",
  "succeeded",
  "failed",
  "cancelled",
  "blocked",
]);

type ReadRunStatus = z.infer<typeof readRunStatusSchema>;

const readRunInputSchema = z.object({
  run_id_or_issue_identifier: z
    .string()
    .min(1)
    .describe("Issue identifier like ISS-43, or a specific issue_run UUID."),
});

const issueSourceToolInputSchema = z
  .object({
    connector_id: issueSourceBindingInsertSchema.shape.connectorId.describe(
      "Connector id for the external source, such as github, slack, gmail, or google_drive.",
    ),
    source_kind: issueSourceBindingInsertSchema.shape.sourceKind.describe(
      "External source kind, such as pull_request, thread, email_thread, file, or search_result.",
    ),
    external_id: issueSourceBindingInsertSchema.shape.externalId.describe(
      "Stable external id from the connector.",
    ),
    external_url: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Optional URL the user can open to view the source."),
  })
  .strict();

const createIssueInputSchema = z
  .object({
    title: issueInsertSchema.shape.title.describe("Short issue title."),
    description: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Optional issue description."),
    assignee_agent_id: issueInsertSchema.shape.assigneeId
      .optional()
      .describe("Assign the issue to this agent id and start it immediately."),
    source: issueSourceToolInputSchema
      .optional()
      .describe("Optional external object to bind to the new issue."),
  })
  .strict();

const readIssueInputSchema = z
  .object({
    issue_id_or_identifier: z
      .string()
      .min(1)
      .describe("Issue identifier like ISS-43, or an issue UUID."),
    comments_page: z
      .enum(["tail", "head"])
      .optional()
      .describe("Which bounded comment page to load. Default tail returns newest comments."),
    comments_limit: z
      .number()
      .int()
      .positive()
      .max(100)
      .optional()
      .describe("Maximum comments to load for this read. Default 20, max 100."),
    comments_offset: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("Offset into the selected head/tail page. For tail, offset 20 gets the next older page."),
  })
  .strict();

const updateIssueStatusInputSchema = z
  .object({
    issue_id_or_identifier: z
      .string()
      .min(1)
      .describe("Garden issue identifier like ISS-43, or an issue UUID."),
    status: issueStatusSchema.describe(
      "Garden issue status. Use done for completed/resolved work; use cancelled for stopped/dropped work.",
    ),
  })
  .strict();

const workspaceInventorySectionSchema = z.enum([
  "agents",
  "members",
  "skills",
  "connectors",
]);

const listWorkspaceInventoryInputSchema = z
  .object({
    include: z
      .array(workspaceInventorySectionSchema)
      .max(4)
      .optional()
      .describe(
        "Inventory sections to include. Defaults to agents only for compactness.",
      ),
    query: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        "Optional case-insensitive filter for names, slugs, roles, connectors, or tool names.",
      ),
    limit: z
      .number()
      .int()
      .positive()
      .max(50)
      .optional()
      .describe("Maximum rows per requested section. Defaults to 20."),
  })
  .strict();

const listIssuesInputSchema = z
  .object({
    assignee_agent_id: issueInsertSchema.shape.assigneeId
      .optional()
      .describe("Only list issues assigned to this agent id."),
    status: issueStatusSchema
      .optional()
      .describe("Only list issues in this status."),
    mine: z
      .boolean()
      .optional()
      .describe("Only list issues assigned to the chat user."),
    limit: z
      .number()
      .int()
      .positive()
      .max(100)
      .optional()
      .describe("Maximum number of issues to return. Defaults to 20."),
  })
  .strict();

const postIssueCommentInputSchema = z
  .object({
    issue_id_or_identifier: z
      .string()
      .min(1)
      .describe("Issue identifier like ISS-43, or an issue UUID."),
    body: issueCommentInsertSchema.shape.body.describe(
      "Comment body to post as the chat user.",
    ),
  })
  .strict();

type CreateIssueToolResult = {
  issue_id: string;
  identifier: string;
};

type AssignIssueToolResult = {
  issue_id: string;
  identifier: string;
  assignee:
    | { type: "agent"; id: string }
    | { type: "member"; id: string; name: string; email: string };
  assignee_agent_id?: string;
  notifications?: {
    subscriber: "ok" | "failed" | "not_needed";
    inbox: "ok" | "failed" | "not_needed";
  };
  run:
    | { kind: "started"; run_id: string }
    | { kind: "resumed"; run_id: string }
    | { kind: "skipped"; reason: string };
};

type UpdateIssueStatusToolResult = {
  issue_id: string;
  identifier: string;
  previous_status: string;
  status: string;
  cancelled_runs: string[];
};

type WorkspaceInventoryToolResult = {
  current_agent_id: string;
  sections: Array<"agents" | "members" | "skills" | "connectors">;
  omitted_sections: Array<"agents" | "members" | "skills" | "connectors">;
  guidance: string[];
  limit: number;
  query: string | null;
  truncated: {
    agents: boolean;
    members: boolean;
    skills: boolean;
    connectors: boolean;
  };
  agents: Array<{
    id: string;
    name: string;
    role: string | null;
    is_default: boolean;
    status: string;
  }>;
  members: Array<{
    id: string;
    membership_id: string;
    name: string;
    email: string;
    role: string;
  }>;
  skills: Array<{
    slug: string;
    name: string;
    description: string | null;
    assigned_to_current_agent: boolean;
  }>;
  connectors: Array<{
    id: string;
    label: string;
    description: string;
    connected: boolean;
    status: string | null;
    account_login: string | null;
    auth_kind: string | null;
    repository_selection?: string | null;
    tools: Array<{
      name: string;
      risk_class: string;
      current_agent_trust: string | null;
    }>;
  }>;
};

const pendingQuestionPayloadSchema = z.object({
  question: z.string(),
  options: z
    .array(
      z.object({
        label: z.string(),
        description: z.string().optional(),
      }),
    )
    .default([]),
  multiSelect: z.boolean().optional(),
});

const pendingApprovalPayloadSchema = z.object({
  title: z.string(),
  body: z.string(),
  targetLabel: z.string().optional(),
});

type ReadRunToolResult = {
  status: ReadRunStatus;
  started_at: string | null;
  last_event_summary: string | null;
  plan: Array<{
    content: string;
    status: "pending" | "in_progress" | "completed";
    activeForm: string;
  }> | null;
  pending_question: {
    question: string;
    options: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  } | null;
  pending_approval_preview: {
    title: string;
    body: string;
    targetLabel?: string;
  } | null;
  work_products_summary: Array<{
    id: string;
    type: string;
    title: string;
    status: string;
  }>;
};

type ReadRunToolContext = {
  databaseUrl: string;
  threadId: string;
  issueRunEnv?: IssueRunEnv;
};

type ChatIssueToolContext = {
  databaseUrl: string;
  threadId: string;
  issueRunEnv: IssueRunEnv;
};

const COMPACT_EXECUTE_DESCRIPTION =
  "Run JavaScript in the sandbox for multi-step filesystem work. " +
  "Use state.readFile(path), state.writeFile(path, content), state.glob(pattern), state.readDir(path), state.mkdir(path), state.rm(path), state.cp(from, to), and state.mv(from, to). " +
  "Input is an async arrow function body as JavaScript, not TypeScript. Return the useful result.";

type ChatIssueIdentity = {
  threadId: string;
  workspaceId: string;
  ownerUserId: string;
  agentId: string;
  issuePrefix: string;
};

type ReadRunDb = ReturnType<typeof getReadRunDb>;

type IssueRunRow = {
  id: string;
  issue_id: string;
  agent_id: string;
  agent_host_name: string;
  status: string;
  started_at: unknown;
};

type IssueRunEventRow = {
  event_type: string;
  message: string | null;
  payload: unknown;
};

type IssueWorkProductRow = {
  id: string;
  type: string;
  title: string | null;
  status: string;
};

/**
 * Resolves the chat-tools read Drizzle client through Hyperdrive's pooled
 * connection string. Callers pass `env.HYPERDRIVE.connectionString`. Previously
 * called `drizzle(databaseUrl)` from the neon-serverless driver, opening a fresh
 * direct-to-Neon WebSocket pool per call that bypassed Hyperdrive, never closed,
 * and defeated Neon autosuspend. `getPooledDb` memoizes one node-postgres pool
 * per connection string per isolate so Hyperdrive owns origin pooling.
 */
function getReadRunDb(databaseUrl: string) {
  return getPooledDb(databaseUrl);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function readRunErr<T>(error: string): ResultValue<T, string> {
  return Result.err<T, string>(error);
}

function parseIssueIdentifier(value: string) {
  const match = /^[A-Z0-9]{2,8}-(\d+)$/i.exec(value.trim());
  const numberText = match?.[1];
  if (!numberText) return null;
  const issueNumber = Number(numberText);
  return Number.isSafeInteger(issueNumber) ? issueNumber : null;
}

function toIsoString(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseRunStatus(value: string): ResultValue<ReadRunStatus, string> {
  const parsed = readRunStatusSchema.safeParse(value);
  return parsed.success
    ? Result.ok(parsed.data)
    : readRunErr(`read_run: invalid run status "${value}"`);
}

async function readRunRows<TRow extends Record<string, unknown>>(
  db: ReadRunDb,
  query: SQLWrapper | string,
): Promise<ResultValue<TRow[], string>> {
  return await Result.tryPromise<TRow[], string>({
    try: async () => {
      const rows = await db.execute<TRow>(query);
      return [...rows.rows] as TRow[];
    },
    catch: errorMessage,
  });
}

async function loadChatThreadContext(context: {
  databaseUrl: string;
  threadId: string;
}): Promise<ResultValue<{ db: ReadRunDb } & ChatIssueIdentity, string>> {
  const db = getReadRunDb(context.databaseUrl);
  const result = await Result.tryPromise<ChatIssueIdentity | null, string>({
    try: async () => {
      const [row] = await db
        .select({
          threadId: schema.chatThread.id,
          workspaceId: schema.chatThread.workspaceId,
          ownerUserId: schema.chatThread.ownerUserId,
          agentId: schema.chatThread.agentId,
          issuePrefix: schema.organization.issuePrefix,
        })
        .from(schema.chatThread)
        .innerJoin(
          schema.organization,
          eq(schema.organization.id, schema.chatThread.workspaceId),
        )
        .where(
          or(
            eq(schema.chatThread.id, context.threadId),
            eq(schema.chatThread.runtimeKey, context.threadId),
          ),
        )
        .limit(1);
      return row ?? null;
    },
    catch: errorMessage,
  });
  if (result.isErr()) return Result.err(result.error);
  return result.value
    ? Result.ok({ db, ...result.value })
    : Result.err("chat thread not found.");
}

async function loadReadRunWorkspace(context: ReadRunToolContext): Promise<
  ResultValue<
    {
      db: ReadRunDb;
      workspaceId: string;
      issuePrefix: string;
    },
    string
  >
> {
  const threadResult = await loadChatThreadContext(context);
  if (threadResult.isErr()) {
    return readRunErr(`read_run: ${threadResult.error}`);
  }
  return Result.ok({
    db: threadResult.value.db,
    workspaceId: threadResult.value.workspaceId,
    issuePrefix: threadResult.value.issuePrefix,
  });
}

function issueToolErr<T>(error: string): ResultValue<T, string> {
  return Result.err<T, string>(error);
}

async function loadChatIssueIdentity(
  context: ChatIssueToolContext,
): Promise<ResultValue<ChatIssueIdentity, string>> {
  const result = await loadChatThreadContext(context);
  if (result.isErr()) return Result.err(result.error);
  return Result.ok({
    threadId: result.value.threadId,
    workspaceId: result.value.workspaceId,
    ownerUserId: result.value.ownerUserId,
    agentId: result.value.agentId,
    issuePrefix: result.value.issuePrefix,
  });
}

async function requireActiveWorkspaceAgent(args: {
  db: ReadRunDb;
  workspaceId: string;
  agentId: string;
}): Promise<ResultValue<void, string>> {
  const result = await Result.tryPromise<boolean, string>({
    try: async () => {
      const [agent] = await args.db
        .select({ id: schema.agent.id })
        .from(schema.agent)
        .where(
          and(
            eq(schema.agent.id, args.agentId),
            eq(schema.agent.workspaceId, args.workspaceId),
            eq(schema.agent.status, "active"),
          ),
        )
        .limit(1);
      return Boolean(agent);
    },
    catch: errorMessage,
  });
  if (result.isErr()) return issueToolErr(result.error);
  return result.value
    ? Result.ok(undefined)
    : issueToolErr(
        "assignee_agent_id must be an active agent in this workspace.",
      );
}

/** Loads human assignee candidates from the current workspace only. */
async function loadWorkspaceMemberCandidates(args: {
  db: ReadRunDb;
  workspaceId: string;
}): Promise<ResultValue<WorkspaceMemberCandidate[], string>> {
  const result = await Result.tryPromise<WorkspaceMemberCandidate[], string>({
    try: async () => {
      const rows = await args.db
        .select({
          membershipId: schema.member.id,
          userId: schema.user.id,
          name: schema.user.name,
          email: schema.user.email,
          role: schema.member.role,
        })
        .from(schema.member)
        .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
        .where(eq(schema.member.organizationId, args.workspaceId))
        .orderBy(schema.user.name, schema.user.email);
      return rows;
    },
    catch: errorMessage,
  });
  return result.isErr() ? issueToolErr(result.error) : Result.ok(result.value);
}

async function resolveChatIssue(args: {
  db: ReadRunDb;
  workspaceId: string;
  issueIdOrIdentifier: string;
}): Promise<
  ResultValue<
    {
      id: string;
      status: string | null;
      activeRunId: string | null;
      assigneeType: string | null;
      assigneeId: string | null;
    },
    string
  >
> {
  const issueNumber = parseIssueIdentifier(args.issueIdOrIdentifier);
  const issueUuid = z
    .string()
    .uuid()
    .safeParse(args.issueIdOrIdentifier.trim());
  const issueCondition =
    issueNumber !== null
      ? eq(schema.issue.number, issueNumber)
      : issueUuid.success
        ? eq(schema.issue.id, issueUuid.data)
        : null;
  if (!issueCondition) {
    return issueToolErr("assign_issue: issue must be an identifier or UUID.");
  }

  const result = await Result.tryPromise<
    {
      id: string;
      status: string | null;
      activeRunId: string | null;
      assigneeType: string | null;
      assigneeId: string | null;
    } | null,
    string
  >({
    try: async () => {
      const [issue] = await args.db
        .select({
          id: schema.issue.id,
          status: schema.issue.status,
          activeRunId: schema.issue.activeRunId,
          assigneeType: schema.issue.assigneeType,
          assigneeId: schema.issue.assigneeId,
        })
        .from(schema.issue)
        .where(
          and(eq(schema.issue.workspaceId, args.workspaceId), issueCondition),
        )
        .limit(1);
      return issue ?? null;
    },
    catch: errorMessage,
  });
  if (result.isErr()) return issueToolErr(result.error);
  return result.value
    ? Result.ok(result.value)
    : issueToolErr("Issue not found.");
}

async function resolveIssueRun(args: {
  db: ReadRunDb;
  workspaceId: string;
  issuePrefix: string;
  runIdOrIssueIdentifier: string;
}): Promise<ResultValue<IssueRunRow, string>> {
  const issueNumber = parseIssueIdentifier(args.runIdOrIssueIdentifier);
  if (issueNumber !== null) {
    const rowsResult = await readRunRows<IssueRunRow>(
      args.db,
      sql`
        select
          r.id,
          r.issue_id,
          r.agent_id,
          r.host_name as agent_host_name,
          r.status,
          r.started_at
        from issue i
        join issue_run r on r.issue_id = i.id
        where i.workspace_id = ${args.workspaceId}
          and i.number = ${issueNumber}
        order by r.created_at desc
        limit 1
      `,
    );
    if (rowsResult.isErr()) return readRunErr(rowsResult.error);
    const [run] = rowsResult.value;
    return run
      ? Result.ok(run)
      : readRunErr(
          `read_run: no run found for ${formatIssueIdentifier(args.issuePrefix, issueNumber)}`,
        );
  }

  const runId = z.string().uuid().safeParse(args.runIdOrIssueIdentifier.trim());
  if (!runId.success) {
    return readRunErr(
      "read_run: expected an issue identifier like ISS-43 or a run UUID.",
    );
  }

  const rowsResult = await readRunRows<IssueRunRow>(
    args.db,
    sql`
      select
        id,
        issue_id,
        agent_id,
        host_name as agent_host_name,
        status,
        started_at
      from issue_run
      where workspace_id = ${args.workspaceId}
        and id = ${runId.data}
      limit 1
    `,
  );
  if (rowsResult.isErr()) return readRunErr(rowsResult.error);
  const [run] = rowsResult.value;
  return run
    ? Result.ok(run)
    : readRunErr(`read_run: no run found for ${runId.data}`);
}

async function latestRunEvent(args: {
  db: ReadRunDb;
  workspaceId: string;
  runId: string;
  eventType?: string;
}): Promise<ResultValue<IssueRunEventRow | null, string>> {
  const eventFilter = args.eventType
    ? sql`and event_type = ${args.eventType}`
    : sql``;
  const rowsResult = await readRunRows<IssueRunEventRow>(
    args.db,
    sql`
      select event_type, message, payload
      from issue_run_event
      where workspace_id = ${args.workspaceId}
        and run_id = ${args.runId}
        ${eventFilter}
      order by seq desc
      limit 1
    `,
  );
  if (rowsResult.isErr()) return readRunErr(rowsResult.error);
  return Result.ok(rowsResult.value[0] ?? null);
}

async function listRunWorkProducts(args: {
  db: ReadRunDb;
  workspaceId: string;
  runId: string;
}): Promise<ResultValue<IssueWorkProductRow[], string>> {
  return await readRunRows<IssueWorkProductRow>(
    args.db,
    sql`
      select id, type, title, status
      from issue_work_product
      where workspace_id = ${args.workspaceId}
        and run_id = ${args.runId}
      order by updated_at desc
    `,
  );
}

function eventSummary(event: IssueRunEventRow | null) {
  if (!event) return null;
  const message = event.message?.trim();
  return message && message.length > 0 ? message : event.event_type;
}

function pendingQuestionFromEvent(event: IssueRunEventRow | null) {
  if (!event) return null;
  const parsed = pendingQuestionPayloadSchema.safeParse(event.payload);
  if (!parsed.success) return null;
  return {
    question: parsed.data.question,
    options: parsed.data.options.map((option) => ({
      label: option.label,
      ...(option.description !== undefined
        ? { description: option.description }
        : {}),
    })),
    ...(parsed.data.multiSelect !== undefined
      ? { multiSelect: parsed.data.multiSelect }
      : {}),
  };
}

function pendingApprovalFromEvent(event: IssueRunEventRow | null) {
  if (!event) return null;
  const parsed = pendingApprovalPayloadSchema.safeParse(event.payload);
  if (!parsed.success) return null;
  return {
    title: parsed.data.title,
    body: parsed.data.body,
    ...(parsed.data.targetLabel !== undefined
      ? { targetLabel: parsed.data.targetLabel }
      : {}),
  };
}

async function readRunPlan(args: {
  context: ReadRunToolContext;
  runId: string;
  issueId: string;
  agentId: string;
  agentHostName: string;
}): Promise<ReadRunToolResult['plan']> {
  if (!args.context.issueRunEnv?.AgentDO) return null;
  const { AgentDO } = args.context.issueRunEnv;
  const agentDoId = AgentDO.idFromName(args.agentHostName);
  const stub = AgentDO.get(agentDoId) as unknown as {
    getRunPlan: (input: { runId: string; issueId: string }) => Promise<
      Array<{ content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm: string }> | null
    >;
  };
  return disposeRpcResult(
    await stub.getRunPlan({ runId: args.runId, issueId: args.issueId }),
  );
}

async function readRun(
  context: ReadRunToolContext,
  runIdOrIssueIdentifier: string,
): Promise<ResultValue<ReadRunToolResult, string>> {
  const workspaceResult = await loadReadRunWorkspace(context);
  if (workspaceResult.isErr()) return readRunErr(workspaceResult.error);
  const { db, workspaceId, issuePrefix } = workspaceResult.value;

  const runResult = await resolveIssueRun({
    db,
    workspaceId,
    issuePrefix,
    runIdOrIssueIdentifier,
  });
  if (runResult.isErr()) return readRunErr(runResult.error);
  const run = runResult.value;

  const statusResult = parseRunStatus(run.status);
  if (statusResult.isErr()) return readRunErr(statusResult.error);

  const latestEventResult = await latestRunEvent({
    db,
    workspaceId,
    runId: run.id,
  });
  if (latestEventResult.isErr()) return readRunErr(latestEventResult.error);

  const questionEventResult = await latestRunEvent({
    db,
    workspaceId,
    runId: run.id,
    eventType: "issue_run:input_requested",
  });
  if (questionEventResult.isErr()) return readRunErr(questionEventResult.error);

  const approvalEventResult = await latestRunEvent({
    db,
    workspaceId,
    runId: run.id,
    eventType: "issue_run:approval_requested",
  });
  if (approvalEventResult.isErr()) return readRunErr(approvalEventResult.error);

  const workProductsResult = await listRunWorkProducts({
    db,
    workspaceId,
    runId: run.id,
  });
  if (workProductsResult.isErr()) return readRunErr(workProductsResult.error);

  return Result.ok({
    status: statusResult.value,
    started_at: toIsoString(run.started_at),
    last_event_summary: eventSummary(latestEventResult.value),
    plan: await readRunPlan({
      context,
      runId: run.id,
      issueId: run.issue_id,
      agentId: run.agent_id,
      agentHostName: run.agent_host_name,
    }),
    pending_question:
      statusResult.value === "waiting_for_input"
        ? pendingQuestionFromEvent(questionEventResult.value)
        : null,
    pending_approval_preview:
      statusResult.value === "waiting_for_approval"
        ? pendingApprovalFromEvent(approvalEventResult.value)
        : null,
    work_products_summary: workProductsResult.value.map((workProduct) => ({
      id: workProduct.id,
      type: workProduct.type,
      title: workProduct.title ?? workProduct.type,
      status: workProduct.status,
    })),
  });
}

async function createIssueFromChat(
  context: ChatIssueToolContext,
  input: z.infer<typeof createIssueInputSchema>,
): Promise<ResultValue<CreateIssueToolResult, string>> {
  const identityResult = await loadChatIssueIdentity(context);
  if (identityResult.isErr()) return Result.err(identityResult.error);
  const identity = identityResult.value;
  const db = getReadRunDb(context.databaseUrl);

  const assigneeAgentId = input.assignee_agent_id;
  if (assigneeAgentId) {
    const assigneeResult = await requireActiveWorkspaceAgent({
      db,
      workspaceId: identity.workspaceId,
      agentId: assigneeAgentId,
    });
    if (assigneeResult.isErr())
      return issueToolErr(`create_issue: ${assigneeResult.error}`);
  }

  const issueResult = await createIssueService({
    databaseUrl: context.databaseUrl,
    workspaceId: identity.workspaceId,
    title: input.title,
    description: input.description ?? null,
    status: "todo",
    priority: "medium",
    createdBy: identity.ownerUserId,
    assigneeType: input.assignee_agent_id ? "agent" : null,
    assigneeId: input.assignee_agent_id ?? null,
    source: input.source
      ? {
          connectorId: input.source.connector_id,
          sourceKind: input.source.source_kind,
          externalId: input.source.external_id,
          externalUrl: input.source.external_url,
        }
      : undefined,
  });
  if (issueResult.isErr()) return issueToolErr(issueResult.error.message);

  const issue = issueResult.value;
  const linkResult = await Result.tryPromise<void, string>({
    try: async () => {
      await db
        .update(schema.chatThread)
        .set({ primaryIssueId: issue.id, updatedAt: new Date() })
        .where(
          and(
            eq(schema.chatThread.id, identity.threadId),
            isNull(schema.chatThread.primaryIssueId),
          ),
        );
    },
    catch: errorMessage,
  });
  if (linkResult.isErr()) return issueToolErr(linkResult.error);

  return Result.ok({
    issue_id: issue.id,
    identifier: issue.identifier,
  });
}

/**
 * Assigns an existing issue to either an agent or a human workspace member.
 * Agent assignment starts active work but leaves todo issues queued. Human
 * assignment stores the canonical user id, joins/notifies the assignee, and
 * cancels the prior active agent run so work does not continue under stale ownership.
 */
async function assignIssueFromChat(
  context: ChatIssueToolContext,
  input: z.infer<typeof assignIssueInputSchema>,
): Promise<ResultValue<AssignIssueToolResult, string>> {
  const identityResult = await loadChatIssueIdentity(context);
  if (identityResult.isErr()) return Result.err(identityResult.error);
  const identity = identityResult.value;
  const db = getReadRunDb(context.databaseUrl);

  const issueResult = await resolveChatIssue({
    db,
    workspaceId: identity.workspaceId,
    issueIdOrIdentifier: input.issue_id_or_identifier,
  });
  if (issueResult.isErr()) return issueToolErr(issueResult.error);
  const issue = issueResult.value;
  const currentStatus = issue.status ?? "todo";
  if (currentStatus === "done" || currentStatus === "cancelled") {
    return issueToolErr(`assign_issue: cannot assign a ${currentStatus} issue.`);
  }

  if ("assignee_member" in input) {
    const membersResult = await loadWorkspaceMemberCandidates({
      db,
      workspaceId: identity.workspaceId,
    });
    if (membersResult.isErr()) return issueToolErr(membersResult.error);
    const memberResult = resolveWorkspaceMember(
      membersResult.value,
      input.assignee_member,
    );
    if (memberResult.isErr()) {
      return issueToolErr(`assign_issue: ${memberResult.error}`);
    }
    const member = memberResult.value;

    if (issue.activeRunId) {
      const cancelResult = await cancelIssueRunService(context.issueRunEnv, {
        workspaceId: identity.workspaceId,
        runId: issue.activeRunId,
        actor: { type: "agent", id: identity.agentId },
        reason: "issue_reassigned_to_member",
      });
      if (cancelResult.isErr()) {
        return issueToolErr(
          `assign_issue: failed to stop the active agent run: ${cancelResult.error.message}`,
        );
      }
    }

    const assignmentChanged =
      issue.assigneeType !== "user" || issue.assigneeId !== member.userId;
    if (assignmentChanged) {
      const updateResult = await Result.tryPromise<void, string>({
        try: async () => {
          await db
            .update(schema.issue)
            .set({
              assigneeType: "user",
              assigneeId: member.userId,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schema.issue.id, issue.id),
                eq(schema.issue.workspaceId, identity.workspaceId),
              ),
            );
        },
        catch: errorMessage,
      });
      if (updateResult.isErr()) return issueToolErr(updateResult.error);
    }

    let subscriberStatus: "ok" | "failed" | "not_needed" = "not_needed";
    let inboxStatus: "ok" | "failed" | "not_needed" = "not_needed";
    if (assignmentChanged) {
      const subscriberResult = await Result.tryPromise<void, string>({
        try: async () => {
          await addIssueSubscribers(db, {
            workspaceId: identity.workspaceId,
            issueId: issue.id,
            entries: [
              {
                userType: "member",
                userId: member.userId,
                reason: "assignee",
              },
            ],
          });
        },
        catch: errorMessage,
      });
      subscriberStatus = subscriberResult.isErr() ? "failed" : "ok";
      if (subscriberResult.isErr()) {
        console.error("assign_issue_member_subscriber_failed", {
          issueId: issue.id,
          memberId: member.userId,
          error: subscriberResult.error,
        });
      }

      const inboxResult = await Result.tryPromise<void, string>({
        try: async () => {
          await upsertIssueAssignmentInbox({
            db,
            workspaceId: identity.workspaceId,
            issueId: issue.id,
            actorType: "agent",
            actorId: identity.agentId,
          });
        },
        catch: errorMessage,
      });
      inboxStatus = inboxResult.isErr() ? "failed" : "ok";
      if (inboxResult.isErr()) {
        console.error("assign_issue_member_inbox_failed", {
          issueId: issue.id,
          memberId: member.userId,
          error: inboxResult.error,
        });
      }
    }

    const summaryResult = await readIssueService({
      databaseUrl: context.databaseUrl,
      workspaceId: identity.workspaceId,
      issueIdOrIdentifier: issue.id,
    });
    if (summaryResult.isErr()) return issueToolErr(summaryResult.error.message);

    return Result.ok({
      issue_id: issue.id,
      identifier: summaryResult.value.identifier,
      assignee: {
        type: "member",
        id: member.userId,
        name: member.name,
        email: member.email,
      },
      notifications: {
        subscriber: subscriberStatus,
        inbox: inboxStatus,
      },
      run: {
        kind: "skipped",
        reason: assignmentChanged
          ? "Assigned to a human workspace member."
          : "Issue was already assigned to this workspace member.",
      },
    });
  }

  const assigneeAgentId =
    "assignee_agent_id" in input ? input.assignee_agent_id : null;
  if (!assigneeAgentId) {
    return issueToolErr(
      "assign_issue: provide assignee_agent_id or assignee_member.",
    );
  }
  const assigneeResult = await requireActiveWorkspaceAgent({
    db,
    workspaceId: identity.workspaceId,
    agentId: assigneeAgentId,
  });
  if (assigneeResult.isErr()) {
    return issueToolErr(`assign_issue: ${assigneeResult.error}`);
  }

  const updateResult = await Result.tryPromise<void, string>({
    try: async () => {
      await db
        .update(schema.issue)
        .set({
          assigneeType: "agent",
          assigneeId: assigneeAgentId,
          status: currentStatus,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.issue.id, issue.id),
            eq(schema.issue.workspaceId, identity.workspaceId),
          ),
        );
    },
    catch: errorMessage,
  });
  if (updateResult.isErr()) return issueToolErr(updateResult.error);

  const startResult = await startIssueRun(context.issueRunEnv, {
    workspaceId: identity.workspaceId,
    issueId: issue.id,
    agentId: assigneeAgentId,
    source: "assignment",
    actor: { type: "agent", id: identity.agentId },
  });
  if (startResult.isErr()) return issueToolErr(startResult.error.message);

  const summaryResult = await readIssueService({
    databaseUrl: context.databaseUrl,
    workspaceId: identity.workspaceId,
    issueIdOrIdentifier: issue.id,
  });
  if (summaryResult.isErr()) return issueToolErr(summaryResult.error.message);

  return Result.ok({
    issue_id: issue.id,
    identifier: summaryResult.value.identifier,
    assignee: { type: "agent", id: assigneeAgentId },
    assignee_agent_id: assigneeAgentId,
    run:
      startResult.value.kind === "started"
        ? { kind: "started", run_id: startResult.value.runId }
        : startResult.value.kind === "resumed"
          ? { kind: "resumed", run_id: startResult.value.runId }
          : { kind: "skipped", reason: startResult.value.reason },
  });
}

async function updateIssueStatusFromChat(
  context: ChatIssueToolContext,
  input: z.infer<typeof updateIssueStatusInputSchema>,
  cancelIssueRun?: ChatSubAgentToolsInput["cancelIssueRun"],
): Promise<ResultValue<UpdateIssueStatusToolResult, string>> {
  const identityResult = await loadChatIssueIdentity(context);
  if (identityResult.isErr()) return Result.err(identityResult.error);
  const identity = identityResult.value;
  const db = getReadRunDb(context.databaseUrl);

  const issueResult = await resolveChatIssue({
    db,
    workspaceId: identity.workspaceId,
    issueIdOrIdentifier: input.issue_id_or_identifier,
  });
  if (issueResult.isErr()) return issueToolErr(issueResult.error);
  const issue = issueResult.value;
  const previousStatus = issue.status ?? "todo";
  const nextStatus = input.status;
  const shouldCancelRuns = isTerminalIssueStatus(nextStatus);

  const liveRunsResult = shouldCancelRuns
    ? await Result.tryPromise<Array<{ id: string; issueId: string }>, string>({
        try: async () => {
          const rows = await db
            .select({
              id: schema.issueRun.id,
              issueId: schema.issueRun.issueId,
            })
            .from(schema.issueRun)
            .where(
              and(
                eq(schema.issueRun.workspaceId, identity.workspaceId),
                eq(schema.issueRun.issueId, issue.id),
                inArray(schema.issueRun.status, LIVE_RUN_STATUSES),
              ),
            )
          return rows.map((row) => ({ id: row.id, issueId: issue.id }))
        },
        catch: errorMessage,
      })
    : Result.ok<Array<{ id: string; issueId: string }>, string>([]);
  if (liveRunsResult.isErr()) return issueToolErr(liveRunsResult.error);

  const updateResult = await Result.tryPromise<void, string>({
    try: async () => {
      await db
        .update(schema.issue)
        .set({
          status: nextStatus,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.issue.id, issue.id),
            eq(schema.issue.workspaceId, identity.workspaceId),
          ),
        );
    },
    catch: errorMessage,
  });
  if (updateResult.isErr()) return issueToolErr(updateResult.error);

  if (
    previousStatus === "todo" &&
    nextStatus === "in_progress" &&
    issue.assigneeType === "agent" &&
    issue.assigneeId
  ) {
    const startResult = await startIssueRun(context.issueRunEnv, {
      workspaceId: identity.workspaceId,
      issueId: issue.id,
      agentId: issue.assigneeId,
      source: "manual",
      actor: { type: "agent", id: identity.agentId },
    });
    if (startResult.isErr()) return issueToolErr(startResult.error.message);
  }

  const cancelledRuns: string[] = [];
  if (shouldCancelRuns && liveRunsResult.value.length > 0) {
    const cancelResult = await Result.tryPromise<void, string>({
      try: async () => {
        const now = new Date();
        for (const run of liveRunsResult.value) {
          await db
            .update(schema.issueRun)
            .set({ cancelRequestedAt: now, updatedAt: now })
            .where(
              and(
                eq(schema.issueRun.id, run.id),
                eq(schema.issueRun.workspaceId, identity.workspaceId),
              ),
            );
          await cancelIssueRun?.({ issueId: run.issueId, runId: run.id });
          cancelledRuns.push(run.id);
        }
      },
      catch: errorMessage,
    });
    if (cancelResult.isErr()) return issueToolErr(cancelResult.error);
  }

  const summaryResult = await readIssueService({
    databaseUrl: context.databaseUrl,
    workspaceId: identity.workspaceId,
    issueIdOrIdentifier: issue.id,
  });
  if (summaryResult.isErr()) return issueToolErr(summaryResult.error.message);

  return Result.ok({
    issue_id: issue.id,
    identifier: summaryResult.value.identifier,
    previous_status: previousStatus,
    status: summaryResult.value.status,
    cancelled_runs: cancelledRuns,
  });
}

async function listWorkspaceInventoryFromChat(
  context: ChatIssueToolContext,
  input: z.infer<typeof listWorkspaceInventoryInputSchema>,
): Promise<ResultValue<WorkspaceInventoryToolResult, string>> {
  const identityResult = await loadChatIssueIdentity(context);
  if (identityResult.isErr()) return Result.err(identityResult.error);
  const identity = identityResult.value;
  const db = getReadRunDb(context.databaseUrl);
  const sections = input.include?.length ? input.include : ["agents" as const];
  const includeAgents = sections.includes("agents");
  const includeMembers = sections.includes("members");
  const includeSkills = sections.includes("skills");
  const includeConnectors = sections.includes("connectors");
  const omittedSections = ([
    "agents",
    "members",
    "skills",
    "connectors",
  ] as const).filter((section) => !sections.includes(section));
  const limit = input.limit ?? 20;
  const normalizedQuery = input.query?.toLowerCase() ?? null;

  const matchesQuery = (...values: Array<string | null | undefined>) =>
    !normalizedQuery ||
    values.some((value) => value?.toLowerCase().includes(normalizedQuery));

  const result = await Result.tryPromise<WorkspaceInventoryToolResult, string>({
    try: async () => {
      const [
        agents,
        members,
        skills,
        assignedSkills,
        connectorBindings,
        capabilityRows,
      ] = await Promise.all([
        includeAgents
          ? db
              .select({
                id: schema.agent.id,
                name: schema.agent.name,
                role: schema.agent.roleTitle,
                isDefault: schema.agent.isDefault,
                status: schema.agent.status,
              })
              .from(schema.agent)
              .where(eq(schema.agent.workspaceId, identity.workspaceId))
              .orderBy(schema.agent.name)
          : [],
        includeMembers
          ? db
              .select({
                id: schema.user.id,
                membershipId: schema.member.id,
                name: schema.user.name,
                email: schema.user.email,
                role: schema.member.role,
              })
              .from(schema.member)
              .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
              .where(eq(schema.member.organizationId, identity.workspaceId))
              .orderBy(schema.user.name, schema.user.email)
          : [],
        includeSkills
            ? db
                .select({
                  slug: schema.skill.slug,
                  name: schema.skill.name,
                  description: schema.skill.description,
                })
                .from(schema.skill)
                .where(eq(schema.skill.workspaceId, identity.workspaceId))
                .orderBy(schema.skill.slug)
            : [],
          includeSkills
            ? db
                .select({ slug: schema.skill.slug })
                .from(schema.agentSkill)
                .innerJoin(
                  schema.skill,
                  eq(schema.skill.id, schema.agentSkill.skillId),
                )
                .where(eq(schema.agentSkill.agentId, identity.agentId))
            : [],
          includeConnectors
            ? listAvailableConnectorBindings({
                db,
                userId: identity.ownerUserId,
                workspaceId: identity.workspaceId,
              })
            : [],
          includeConnectors
            ? db
                .select({
                  connectorType: schema.capability.connectorType,
                  name: schema.capability.name,
                  riskClass: schema.capability.riskClass,
                  trustLevel: schema.permissionGrant.trustLevel,
                })
                .from(schema.capability)
                .leftJoin(
                  schema.permissionGrant,
                  and(
                    eq(
                      schema.permissionGrant.capabilityId,
                      schema.capability.id,
                    ),
                    eq(schema.permissionGrant.agentId, identity.agentId),
                  ),
                )
            : [],
        ]);

      const assignedSkillSlugs = new Set(
        assignedSkills.map((skill) => skill.slug),
      );
      const connectorBindingById = new Map(
        connectorBindings.map((binding) => [binding.connectorId, binding]),
      );
      const capabilitiesByConnector = new Map<
        string,
        Array<{
          name: string;
          risk_class: string;
          current_agent_trust: string | null;
        }>
      >();
      for (const capability of capabilityRows) {
        const tools =
          capabilitiesByConnector.get(capability.connectorType) ?? [];
        tools.push({
          name: capability.name,
          risk_class: capability.riskClass,
          current_agent_trust: capability.trustLevel,
        });
        capabilitiesByConnector.set(capability.connectorType, tools);
      }

      const filteredAgents = agents.filter((agent) =>
        matchesQuery(agent.id, agent.name, agent.role, agent.status),
      );
      const filteredMembers = members.filter((member) =>
        matchesQuery(
          member.id,
          member.membershipId,
          member.name,
          member.email,
          member.role,
        ),
      );
      const filteredSkills = skills.filter((skill) =>
        matchesQuery(skill.slug, skill.name, skill.description),
      );
      const filteredConnectors = includeConnectors
        ? connectorRegistry.flatMap((connector) => {
            const binding = connectorBindingById.get(connector.id);
            const syncedTools = capabilitiesByConnector.get(connector.id);
            const registryTools = Object.entries(connector.tools).map(
              ([name, toolConfig]) => ({
                name,
                risk_class: toolConfig.riskClass,
                current_agent_trust: null,
              }),
            );
            const tools = syncedTools?.length ? syncedTools : registryTools;
            const filteredTools = normalizedQuery
              ? tools.filter((tool) =>
                  matchesQuery(
                    tool.name,
                    tool.risk_class,
                    tool.current_agent_trust,
                  ),
                )
              : tools;
            const connectorMatches = matchesQuery(
              connector.id,
              connector.label,
              connector.description,
              binding ? "connected" : null,
            );
            if (!connectorMatches && filteredTools.length === 0) return [];

            return [
              {
                id: connector.id,
                label: connector.label,
                description: connector.description,
                connected: Boolean(binding),
                status: binding ? "connected" : null,
                account_login: binding?.accountLogin ?? null,
                auth_kind: binding?.authKind ?? null,
                ...(binding?.repositorySelection
                  ? { repository_selection: binding.repositorySelection }
                  : {}),
                tools: filteredTools.slice(0, limit),
              },
            ];
          })
        : [];

      return {
        current_agent_id: identity.agentId,
        sections,
        omitted_sections: omittedSections,
        guidance: [
          "Use current_agent_id when the current agent is an appropriate assignee for a generic or follow-up task.",
          "Prefer assigning to an existing active agent from this inventory. Propose a new agent only when the task calls for a reusable role that is not already represented.",
          includeMembers
            ? "Human workspace members are included. Use their user id, name, or email with assignee_member; membership_id is accepted only as a lookup convenience."
            : "Human members were not requested. Pass a named person directly to assign_issue; request members only if resolution is ambiguous or the user asks who is available.",
          includeConnectors
            ? "Connector/MCP capabilities are included. They are separate from skills; do not require a skill slug for connector tools."
            : "Connector/MCP capabilities were not requested. Do not conclude a capability is unavailable from skills/agents alone; call list_workspace_inventory with include:['connectors'] and a query when connector capability matters.",
          "Skills are instruction bundles. Connector tools are runtime capabilities governed by permission grants.",
        ],
        limit,
        query: input.query ?? null,
        truncated: {
          agents: filteredAgents.length > limit,
          members: filteredMembers.length > limit,
          skills: filteredSkills.length > limit,
          connectors: filteredConnectors.length > limit,
        },
        agents: filteredAgents.slice(0, limit).map((agent) => ({
          id: agent.id,
          name: agent.name,
          role: agent.role,
          is_default: agent.isDefault,
          status: agent.status,
        })),
        members: filteredMembers.slice(0, limit).map((member) => ({
          id: member.id,
          membership_id: member.membershipId,
          name: member.name,
          email: member.email,
          role: member.role,
        })),
        skills: filteredSkills.slice(0, limit).map((skill) => ({
          slug: skill.slug,
          name: skill.name,
          description: skill.description,
          assigned_to_current_agent: assignedSkillSlugs.has(skill.slug),
        })),
        connectors: filteredConnectors.slice(0, limit),
      };
    },
    catch: errorMessage,
  });
  if (result.isErr()) return issueToolErr(result.error);
  return Result.ok(result.value);
}

async function readIssueFromChat(
  context: ChatIssueToolContext,
  input: z.infer<typeof readIssueInputSchema>,
): Promise<ResultValue<IssueSummary, string>> {
  const identityResult = await loadChatIssueIdentity(context);
  if (identityResult.isErr()) return Result.err(identityResult.error);

  const issueResult = await readIssueService({
    databaseUrl: context.databaseUrl,
    workspaceId: identityResult.value.workspaceId,
    issueIdOrIdentifier: input.issue_id_or_identifier,
    commentsPage: input.comments_page,
    commentsLimit: input.comments_limit,
    commentsOffset: input.comments_offset,
  });
  if (issueResult.isErr()) return issueToolErr(issueResult.error.message);
  return Result.ok(issueResult.value);
}

async function listIssuesFromChat(
  context: ChatIssueToolContext,
  input: z.infer<typeof listIssuesInputSchema>,
): Promise<ResultValue<IssueSummary[], string>> {
  const identityResult = await loadChatIssueIdentity(context);
  if (identityResult.isErr()) return Result.err(identityResult.error);
  const identity = identityResult.value;

  const issuesResult = await listIssuesService({
    databaseUrl: context.databaseUrl,
    workspaceId: identity.workspaceId,
    ownerUserId: identity.ownerUserId,
    assigneeAgentId: input.assignee_agent_id,
    status: input.status,
    mine: input.mine,
    limit: input.limit,
  });
  if (issuesResult.isErr()) return issueToolErr(issuesResult.error.message);
  return Result.ok(issuesResult.value);
}

async function postIssueCommentFromChat(
  context: ChatIssueToolContext,
  input: z.infer<typeof postIssueCommentInputSchema>,
): Promise<ResultValue<{ comment_id: string }, string>> {
  const identityResult = await loadChatIssueIdentity(context);
  if (identityResult.isErr()) return Result.err(identityResult.error);
  const identity = identityResult.value;

  const commentResult = await postIssueCommentService({
    databaseUrl: context.databaseUrl,
    issueRunEnv: context.issueRunEnv,
    workspaceId: identity.workspaceId,
    issueIdOrIdentifier: input.issue_id_or_identifier,
    authorUserId: identity.ownerUserId,
    body: input.body,
  });
  if (commentResult.isErr()) return issueToolErr(commentResult.error.message);
  return Result.ok({ comment_id: commentResult.value.comment_id });
}

export function createChatSubAgentTools({
  ctx,
  exaApiKey,
  databaseUrl,
  threadId,
  workspace,
  loader,
  getSandbox,
  issueRunEnv,
  cancelIssueRun,
}: ChatSubAgentToolsInput): ToolSet {
  const documentContext = (): DocumentToolContext | null =>
    databaseUrl && threadId ? { databaseUrl, workspace, threadId } : null;
  const readRunContext = (): ReadRunToolContext | null =>
    databaseUrl && threadId
      ? { databaseUrl, threadId, issueRunEnv }
      : null;
  const chatIssueContext = (): ChatIssueToolContext | null =>
    databaseUrl && threadId && issueRunEnv
      ? { databaseUrl, threadId, issueRunEnv }
      : null;

  return {
    execute: createExecuteTool({
      ctx,
      tools: {},
      state: createWorkspaceStateBackend(workspace),
      loader,
      description: COMPACT_EXECUTE_DESCRIPTION,
    }),
    ...createSandboxTools(getSandbox),
    ...createWebTools({
      env: { ...(exaApiKey ? { EXA_API_KEY: exaApiKey } : {}) },
      sql: (query, ...params) =>
        ctx.storage.sql.exec(query, ...(params as WebToolsSqlValue[])),
    }),

    // Client-side tool — no execute function. The UI renders an interactive
    // StructuredInputPanel and sends the user's selections back via
    // addToolOutput. The model receives the answers as the tool result.
    askUserInput: tool({
      description:
        "Present the user with one or more structured questions to choose from before proceeding. " +
        "Each question shows labelled options the user can pick. Returns a record mapping question id to selected label(s). " +
        "Use this when you need the user to clarify direction, pick preferences, or confirm a choice — not for open-ended questions.",
      inputSchema: z.object({
        questions: z
          .array(
            z.object({
              id: z.string().describe("Unique identifier for this question"),
              header: z
                .string()
                .optional()
                .describe(
                  "Short uppercase section label shown above the question, e.g. TONE or FORMAT",
                ),
              question: z.string().describe("The question to present"),
              options: z
                .array(
                  z.object({
                    label: z.string().describe("Option label"),
                    description: z
                      .string()
                      .optional()
                      .describe("Brief clarification shown beside the label"),
                  }),
                )
                .min(2)
                .describe("Available options"),
              multiSelect: z
                .boolean()
                .optional()
                .describe("Allow selecting multiple options (default false)"),
            }),
          )
          .min(1)
          .describe("Questions to ask the user"),
      }),
    }),

    propose_agent: createProposeAgentTool({ databaseUrl, threadId }),

    create_issue: tool({
      description:
        "Create a Garden issue from chat. Optionally assign it to an agent and bind it to an external source. " +
        "Use assignee_agent_id when the user asks for an agent to do the work; assigned issues start immediately in todo. " +
        "Before assigning, list workspace agents and choose an existing active agent; the current agent is a valid assignee when it is the right owner.",
      inputSchema: createIssueInputSchema,
      execute: async (input) => {
        const context = chatIssueContext();
        if (!context) {
          return Result.serialize(
            Result.err<CreateIssueToolResult, string>(
              "create_issue: database tools are not configured.",
            ),
          );
        }
        return Result.serialize(await createIssueFromChat(context, input));
      },
    }),

    assign_issue: tool({
      description:
        "Assign an existing Garden issue to either an active workspace agent or a human workspace member. " +
        "Agent assignment starts that agent immediately; human assignment notifies the member and does not start an agent run. " +
        "When the user names a human, pass that name/email/id directly as assignee_member; use member inventory only after an ambiguous/missing result. Never guess between people with similar names.",
      inputSchema: assignIssueInputSchema,
      execute: async (input) => {
        const context = chatIssueContext();
        if (!context) {
          return Result.serialize(
            Result.err<AssignIssueToolResult, string>(
              "assign_issue: database tools are not configured.",
            ),
          );
        }
        return Result.serialize(await assignIssueFromChat(context, input));
      },
    }),

    list_workspace_inventory: tool({
      description:
        "List bounded current workspace inventory. Defaults to agents only; request members, skills, or connectors when needed. " +
        "Use when browsing possible owners, proposing an agent, resolving an ambiguous person, or checking skills/connectors. " +
        "Use current_agent_id for agent self-assignment; direct named human assignments do not need an inventory preflight.",
      inputSchema: listWorkspaceInventoryInputSchema,
      execute: async (input) => {
        const context = chatIssueContext();
        if (!context) {
          return Result.serialize(
            Result.err<WorkspaceInventoryToolResult, string>(
              "list_workspace_inventory: database tools are not configured.",
            ),
          );
        }
        return Result.serialize(
          await listWorkspaceInventoryFromChat(context, input),
        );
      },
    }),

    read_issue: tool({
      description:
        "Read a Garden issue with its description and a bounded comment thread page for an issue identifier like ISS-43 or an issue UUID. " +
        "Defaults to a tail page of the newest comments; pass comments_limit/comments_offset/comments_page to page like head/tail instead of loading the whole thread.",
      inputSchema: readIssueInputSchema,
      execute: async (input) => {
        const context = chatIssueContext();
        if (!context) {
          return Result.serialize(
            Result.err<IssueSummary, string>(
              "read_issue: database tools are not configured.",
            ),
          );
        }
        return Result.serialize(await readIssueFromChat(context, input));
      },
    }),

    update_issue_status: tool({
      description:
        "Update a Garden issue status in the current workspace. Use status done when the user says complete, resolve, or mark done. Use cancelled when the user says cancel, drop, or stop. If the user only says close and context does not make done vs cancelled clear, ask a clarification question instead of guessing. " +
        "This is for Garden issues only; do not use GitHub issue tools unless the user explicitly names GitHub or asks to update an external GitHub issue.",
      inputSchema: updateIssueStatusInputSchema,
      execute: async (input) => {
        const context = chatIssueContext();
        if (!context) {
          return Result.serialize(
            Result.err<UpdateIssueStatusToolResult, string>(
              "update_issue_status: database tools are not configured.",
            ),
          );
        }
        return Result.serialize(
          await updateIssueStatusFromChat(context, input, cancelIssueRun),
        );
      },
    }),

    list_issues: tool({
      description:
        "List Garden issue summaries in the current workspace. Filter by status, agent assignee, or issues assigned to the chat user.",
      inputSchema: listIssuesInputSchema,
      execute: async (input) => {
        const context = chatIssueContext();
        if (!context) {
          return Result.serialize(
            Result.err<IssueSummary[], string>(
              "list_issues: database tools are not configured.",
            ),
          );
        }
        return Result.serialize(await listIssuesFromChat(context, input));
      },
    }),

    post_issue_comment: tool({
      description:
        "Post a comment to a Garden issue as the chat user. This can wake the assigned or mentioned issue agent.",
      inputSchema: postIssueCommentInputSchema,
      execute: async (input) => {
        const context = chatIssueContext();
        if (!context) {
          return Result.serialize(
            Result.err<{ comment_id: string }, string>(
              "post_issue_comment: database tools are not configured.",
            ),
          );
        }
        return Result.serialize(await postIssueCommentFromChat(context, input));
      },
    }),

    // Example: "What's happening with ISS-43?"
    // → read_run("ISS-43")
    // → "Garden is on turn 3. It's waiting on you for one question: 'Should multi-org users get tenant filtering?' Drafted brief is up for review."
    read_run: tool({
      description:
        "Read live issue-run state for an issue identifier like ISS-43, or for a specific issue_run UUID. " +
        "Use this when the user asks what is happening with an issue, whether an agent is blocked, or what is waiting on them.",
      inputSchema: readRunInputSchema,
      execute: async ({ run_id_or_issue_identifier }) => {
        const context = readRunContext();
        if (!context) {
          return Result.serialize(
            Result.err<ReadRunToolResult, string>(
              "read_run: database tools are not configured.",
            ),
          );
        }
        return Result.serialize(
          await readRun(context, run_id_or_issue_identifier),
        );
      },
    }),

    listDocuments: tool({
      description:
        "List the documents available in this chat/workspace. Use this before reading, searching, or editing when the user refers to a document by name.",
      inputSchema: z.object({}),
      execute: async () => {
        const context = documentContext();
        if (!context) {
          return { ok: false, error: "Document tools are not configured." };
        }
        return await listDocuments(context);
      },
    }),

    readDocument: tool({
      description:
        "Read the full text content of a document. Always call this before answering questions about, summarizing, citing, or editing a document.",
      inputSchema: z.object({
        documentId: z
          .string()
          .uuid()
          .describe(
            "Internal document handle to read. Never show this value to the user.",
          ),
      }),
      execute: async ({ documentId }) => {
        const context = documentContext();
        if (!context) {
          return { ok: false, error: "Document tools are not configured." };
        }
        return await readDocument({ context, documentId });
      },
    }),

    findInDocument: tool({
      description:
        "Search for specific strings inside a document. Matching is case-insensitive and whitespace-tolerant. Use this for targeted lookups instead of reading a whole document.",
      inputSchema: z.object({
        documentId: z
          .string()
          .uuid()
          .describe(
            "Internal document handle to search. Never show this value to the user.",
          ),
        query: z.string().min(1),
        maxResults: z.number().int().positive().max(100).optional(),
        contextChars: z.number().int().positive().max(1000).optional(),
      }),
      execute: async ({ documentId, query, maxResults, contextChars }) => {
        const context = documentContext();
        if (!context) {
          return { ok: false, error: "Document tools are not configured." };
        }
        return await findInDocument({
          context,
          documentId,
          query,
          maxResults,
          contextChars,
        });
      },
    }),

    generateDocx: tool({
      description:
        'Generate a new Word (.docx) document from structured content. Use when the user asks to draft, create, write, or produce a new document. Do not use to update an existing document unless the user explicitly asks for a fresh replacement; use editDocument tracked changes for existing .docx updates. Section content supports **bold** and *italic* inline markdown plus simple "- " or "* " bullet lines. Returns a first-class document artifact.',
      inputSchema: z.object({
        title: z
          .string()
          .min(1)
          .describe("Document title, also used for filename."),
        landscape: z.boolean().optional(),
        sections: z
          .array(
            z.object({
              heading: z.string().optional(),
              level: z.number().int().min(1).max(4).optional(),
              content: z.string().optional(),
              pageBreak: z.boolean().optional(),
              table: z
                .object({
                  headers: z.array(z.string()),
                  rows: z.array(z.array(z.string())),
                })
                .optional(),
            }),
          )
          .min(1),
        options: z
          .object({
            pageSize: z
              .enum(["letter", "a4"])
              .optional()
              .describe(
                'Page size. Defaults to "letter"; pass "a4" for European/UK audiences.',
              ),
            font: z
              .string()
              .optional()
              .describe(
                'Font family. Defaults to "Times New Roman". Use "Arial" or "Calibri" for a more modern look.',
              ),
            header: z
              .string()
              .optional()
              .describe("Optional running header text shown on every page."),
            footer: z
              .string()
              .optional()
              .describe("Optional running footer text shown on every page."),
            pageNumbers: z
              .boolean()
              .optional()
              .describe(
                'When true, adds "Page N of M" to the right side of the footer.',
              ),
          })
          .optional(),
      }),
      execute: async ({ title, sections, landscape, options }) => {
        const context = documentContext();
        if (!context) {
          return { ok: false, error: "Document tools are not configured." };
        }
        return await generateDocx({
          context,
          title,
          sections,
          landscape,
          options,
        });
      },
    }),

    editDocument: tool({
      description:
        "Update an existing .docx document by proposing tracked find/replace changes. Use this for requests like update this document, remove a duplicate title, add research to a section, rewrite a paragraph, or replace text in the current doc. Use readDocument first. Each edit must be a precise substitution with context_before and context_after so it can be located unambiguously. Returns edit annotations and a new document artifact version.",
      inputSchema: z.object({
        documentId: z
          .string()
          .uuid()
          .describe(
            "Internal document handle to edit. Never show this value to the user.",
          ),
        edits: z
          .array(
            z.object({
              find: z.string(),
              replace: z.string(),
              context_before: z.string(),
              context_after: z.string(),
              reason: z.string().optional(),
            }),
          )
          .min(1),
      }),
      execute: async ({ documentId, edits }) => {
        const context = documentContext();
        if (!context) {
          return { ok: false, error: "Document tools are not configured." };
        }
        return await editDocument({ context, documentId, edits });
      },
    }),

    convertDocumentToPdf: tool({
      description:
        "Convert an existing DOC/DOCX document to a PDF artifact by running LibreOffice in the sandbox/code-execution environment, then storing the PDF back into this agent workspace.",
      inputSchema: z.object({
        documentId: z
          .string()
          .uuid()
          .describe(
            "Internal source document handle. Never show this value to the user.",
          ),
      }),
      execute: async ({ documentId }) => {
        const context = documentContext();
        if (!context) {
          return { ok: false, error: "Document tools are not configured." };
        }
        const source = await getDocumentBytes({ context, documentId });
        if (!source.ok) return source;
        if (!source.bytes) {
          return { ok: false, error: "Source document bytes not found." };
        }
        const sourceFilename = source.filename ?? "document.docx";
        const stem = sourceFilename.replace(/\.[^.]+$/, "") || "document";
        const dir = `/workspace/.scratch/document-convert/${documentId}`;
        const inputBase64Path = `${dir}/input.b64`;
        const inputPath = `${dir}/${sourceFilename}`;
        const outputPath = `${dir}/${stem}.pdf`;
        const sandbox = getSandbox();
        await sandbox.mkdir(dir, { recursive: true });
        await sandbox.writeFile(
          inputBase64Path,
          Buffer.from(source.bytes).toString("base64"),
        );
        const command = [
          `base64 -d ${shellQuote(inputBase64Path)} > ${shellQuote(inputPath)}`,
          `(libreoffice --headless --convert-to pdf --outdir ${shellQuote(dir)} ${shellQuote(inputPath)} || soffice --headless --convert-to pdf --outdir ${shellQuote(dir)} ${shellQuote(inputPath)})`,
        ].join(" && ");
        const result = await sandbox.exec(command);
        if (!result.success) {
          return {
            ok: false,
            error:
              result.stderr ||
              result.stdout ||
              "LibreOffice conversion failed in sandbox.",
          };
        }
        const pdf = await sandbox.readFile(outputPath, { encoding: "base64" });
        if (!pdf.success || !pdf.content) {
          return { ok: false, error: "Converted PDF could not be read." };
        }
        return await registerUploadedDocument({
          context,
          filename: `${stem}.pdf`,
          mediaType: "application/pdf",
          bytes: Buffer.from(pdf.content, "base64"),
        });
      },
    }),
  };
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
