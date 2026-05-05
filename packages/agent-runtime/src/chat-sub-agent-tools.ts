import {
  createWorkspaceStateBackend,
  type WorkspaceFsLike,
} from '@cloudflare/shell'
import { Buffer } from 'node:buffer'
import { createExecuteTool } from '@cloudflare/think/tools/execute'
import type { Sandbox as SandboxDO } from '@cloudflare/sandbox'
import { Result, type Result as ResultValue } from 'better-result'
import { tool, type ToolSet } from 'ai'
import { eq, sql, type SQLWrapper } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/neon-serverless'
import { z } from 'zod'
import * as schema from '@garden/db/schema'
import {
  issueCommentInsertSchema,
  issueInsertSchema,
  issueSourceBindingInsertSchema,
  issueStatusSchema,
} from '@garden/db/validation'
import {
  editDocument,
  findInDocument,
  generateDocx,
  getDocumentBytes,
  listDocuments,
  readDocument,
  registerUploadedDocument,
  type DocumentToolContext,
} from './documents/document-tools'
import { createProposeAgentTool } from './agent-tools/propose-agent'
import { createSandboxTools } from './sandbox-tools'
import {
  createIssue as createIssueService,
  listIssues as listIssuesService,
  postIssueComment as postIssueCommentService,
  readIssue as readIssueService,
  type IssueSummary,
} from '../../../apps/web/src/lib/server/issues'
import { startIssueRun } from '../../../apps/web/src/lib/server/issue-run'

type ChatSubAgentToolsInput = {
  databaseUrl?: string
  threadId?: string
  workspace: WorkspaceFsLike
  loader: WorkerLoader
  getSandbox: () => SandboxDO
}

const readRunStatusSchema = z.enum([
  'queued',
  'running',
  'waiting_for_input',
  'waiting_for_approval',
  'succeeded',
  'failed',
  'cancelled',
  'blocked',
])

type ReadRunStatus = z.infer<typeof readRunStatusSchema>

const readRunInputSchema = z.object({
  run_id_or_issue_identifier: z
    .string()
    .min(1)
    .describe('Issue identifier like ACC-43, or a specific issue_run UUID.'),
})

const issueSourceToolInputSchema = z
  .object({
    connector_id: issueSourceBindingInsertSchema.shape.connectorId.describe(
      'Connector id for the external source, such as github, slack, gmail, or google_drive.',
    ),
    source_kind: issueSourceBindingInsertSchema.shape.sourceKind.describe(
      'External source kind, such as pull_request, thread, email_thread, file, or search_result.',
    ),
    external_id: issueSourceBindingInsertSchema.shape.externalId.describe(
      'Stable external id from the connector.',
    ),
    external_url: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Optional URL the user can open to view the source.'),
  })
  .strict()

const createIssueInputSchema = z
  .object({
    title: issueInsertSchema.shape.title.describe('Short issue title.'),
    description: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Optional issue description.'),
    assignee_agent_id: issueInsertSchema.shape.assigneeId
      .optional()
      .describe('Assign the issue to this agent id and start it immediately.'),
    source: issueSourceToolInputSchema
      .optional()
      .describe('Optional external object to bind to the new issue.'),
  })
  .strict()

const readIssueInputSchema = z
  .object({
    issue_id_or_identifier: z
      .string()
      .min(1)
      .describe('Issue identifier like ACC-43, or an issue UUID.'),
  })
  .strict()

const listIssuesInputSchema = z
  .object({
    assignee_agent_id: issueInsertSchema.shape.assigneeId
      .optional()
      .describe('Only list issues assigned to this agent id.'),
    status: issueStatusSchema.optional().describe('Only list issues in this status.'),
    mine: z
      .boolean()
      .optional()
      .describe('Only list issues assigned to the chat user.'),
    limit: z
      .number()
      .int()
      .positive()
      .max(100)
      .optional()
      .describe('Maximum number of issues to return. Defaults to 20.'),
  })
  .strict()

const postIssueCommentInputSchema = z
  .object({
    issue_id_or_identifier: z
      .string()
      .min(1)
      .describe('Issue identifier like ACC-43, or an issue UUID.'),
    body: issueCommentInsertSchema.shape.body.describe(
      'Comment body to post as the chat user.',
    ),
  })
  .strict()

type CreateIssueToolResult = {
  issue_id: string
  identifier: string
}

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
})

const pendingApprovalPayloadSchema = z.object({
  title: z.string(),
  body: z.string(),
  targetLabel: z.string().optional(),
})

type ReadRunToolResult = {
  status: ReadRunStatus
  started_at: string | null
  last_event_summary: string | null
  plan: Array<{
    content: string
    status: 'pending' | 'in_progress' | 'completed'
    activeForm: string
  }> | null
  pending_question: {
    question: string
    options: Array<{ label: string; description?: string }>
    multiSelect?: boolean
  } | null
  pending_approval_preview: {
    title: string
    body: string
    targetLabel?: string
  } | null
  work_products_summary: Array<{
    id: string
    type: string
    title: string
    status: string
  }>
}

type ReadRunToolContext = {
  databaseUrl: string
  threadId: string
}

type ChatIssueToolContext = {
  databaseUrl: string
  threadId: string
}

type ChatIssueIdentity = {
  workspaceId: string
  ownerUserId: string
  agentId: string
}

type ReadRunDb = ReturnType<typeof getReadRunDb>

type IssueRunRow = {
  id: string
  issue_id: string
  agent_id: string
  status: string
  started_at: unknown
}

type IssueRunEventRow = {
  event_type: string
  message: string | null
  payload: unknown
}

type IssueWorkProductRow = {
  id: string
  type: string
  title: string | null
  status: string
}

function getReadRunDb(databaseUrl: string) {
  return drizzle(databaseUrl, { schema })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function readRunErr<T>(error: string): ResultValue<T, string> {
  return Result.err<T, string>(error)
}

function parseIssueIdentifier(value: string) {
  const match = /^ACC-(\d+)$/i.exec(value.trim())
  const numberText = match?.[1]
  if (!numberText) return null
  const issueNumber = Number(numberText)
  return Number.isSafeInteger(issueNumber) ? issueNumber : null
}

function toIsoString(value: unknown) {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function parseRunStatus(value: string): ResultValue<ReadRunStatus, string> {
  const parsed = readRunStatusSchema.safeParse(value)
  return parsed.success
    ? Result.ok(parsed.data)
    : readRunErr(`read_run: invalid run status "${value}"`)
}

async function readRunRows<TRow extends Record<string, unknown>>(
  db: ReadRunDb,
  query: SQLWrapper | string,
): Promise<ResultValue<TRow[], string>> {
  return await Result.tryPromise<TRow[], string>({
    try: async () => {
      const rows = await db.execute<TRow>(query)
      return [...rows.rows] as TRow[]
    },
    catch: errorMessage,
  })
}

async function loadReadRunWorkspace(context: ReadRunToolContext): Promise<
  ResultValue<
    {
      db: ReadRunDb
      workspaceId: string
    },
    string
  >
> {
  const db = getReadRunDb(context.databaseUrl)
  const rowResult = await Result.tryPromise<{ workspaceId: string } | null, string>({
    try: async () => {
      const [row] = await db
        .select({ workspaceId: schema.chatThread.workspaceId })
        .from(schema.chatThread)
        .where(eq(schema.chatThread.id, context.threadId))
        .limit(1)
      return row ?? null
    },
    catch: errorMessage,
  })
  if (rowResult.isErr()) return readRunErr(rowResult.error)
  if (!rowResult.value) return readRunErr('read_run: chat thread not found.')
  return Result.ok({ db, workspaceId: rowResult.value.workspaceId })
}

function issueToolErr<T>(error: string): ResultValue<T, string> {
  return Result.err<T, string>(error)
}

async function loadChatIssueIdentity(
  context: ChatIssueToolContext,
): Promise<ResultValue<ChatIssueIdentity, string>> {
  const db = getReadRunDb(context.databaseUrl)
  const result = await Result.tryPromise<ChatIssueIdentity | null, string>({
    try: async () => {
      const [row] = await db
        .select({
          workspaceId: schema.chatThread.workspaceId,
          ownerUserId: schema.chatThread.ownerUserId,
          agentId: schema.chatThread.agentId,
        })
        .from(schema.chatThread)
        .where(eq(schema.chatThread.id, context.threadId))
        .limit(1)
      return row ?? null
    },
    catch: errorMessage,
  })
  if (result.isErr()) return Result.err(result.error)
  return result.value
    ? Result.ok(result.value)
    : issueToolErr('issue tools: chat thread not found.')
}

async function resolveIssueRun(args: {
  db: ReadRunDb
  workspaceId: string
  runIdOrIssueIdentifier: string
}): Promise<ResultValue<IssueRunRow, string>> {
  const issueNumber = parseIssueIdentifier(args.runIdOrIssueIdentifier)
  if (issueNumber !== null) {
    const rowsResult = await readRunRows<IssueRunRow>(
      args.db,
      sql`
        select
          r.id,
          r.issue_id,
          r.agent_id,
          r.status,
          r.started_at
        from issue i
        join issue_run r on r.issue_id = i.id
        where i.workspace_id = ${args.workspaceId}
          and i.number = ${issueNumber}
        order by r.created_at desc
        limit 1
      `,
    )
    if (rowsResult.isErr()) return readRunErr(rowsResult.error)
    const [run] = rowsResult.value
    return run
      ? Result.ok(run)
      : readRunErr(`read_run: no run found for ACC-${issueNumber}`)
  }

  const runId = z.string().uuid().safeParse(args.runIdOrIssueIdentifier.trim())
  if (!runId.success) {
    return readRunErr(
      'read_run: expected an issue identifier like ACC-43 or a run UUID.',
    )
  }

  const rowsResult = await readRunRows<IssueRunRow>(
    args.db,
    sql`
      select
        id,
        issue_id,
        agent_id,
        status,
        started_at
      from issue_run
      where workspace_id = ${args.workspaceId}
        and id = ${runId.data}
      limit 1
    `,
  )
  if (rowsResult.isErr()) return readRunErr(rowsResult.error)
  const [run] = rowsResult.value
  return run
    ? Result.ok(run)
    : readRunErr(`read_run: no run found for ${runId.data}`)
}

async function latestRunEvent(args: {
  db: ReadRunDb
  workspaceId: string
  runId: string
  eventType?: string
}): Promise<ResultValue<IssueRunEventRow | null, string>> {
  const eventFilter = args.eventType
    ? sql`and event_type = ${args.eventType}`
    : sql``
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
  )
  if (rowsResult.isErr()) return readRunErr(rowsResult.error)
  return Result.ok(rowsResult.value[0] ?? null)
}

async function listRunWorkProducts(args: {
  db: ReadRunDb
  workspaceId: string
  runId: string
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
  )
}

function eventSummary(event: IssueRunEventRow | null) {
  if (!event) return null
  const message = event.message?.trim()
  return message && message.length > 0 ? message : event.event_type
}

function pendingQuestionFromEvent(event: IssueRunEventRow | null) {
  if (!event) return null
  const parsed = pendingQuestionPayloadSchema.safeParse(event.payload)
  if (!parsed.success) return null
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
  }
}

function pendingApprovalFromEvent(event: IssueRunEventRow | null) {
  if (!event) return null
  const parsed = pendingApprovalPayloadSchema.safeParse(event.payload)
  if (!parsed.success) return null
  return {
    title: parsed.data.title,
    body: parsed.data.body,
    ...(parsed.data.targetLabel !== undefined
      ? { targetLabel: parsed.data.targetLabel }
      : {}),
  }
}

async function readRun(
  context: ReadRunToolContext,
  runIdOrIssueIdentifier: string,
): Promise<ResultValue<ReadRunToolResult, string>> {
  const workspaceResult = await loadReadRunWorkspace(context)
  if (workspaceResult.isErr()) return readRunErr(workspaceResult.error)
  const { db, workspaceId } = workspaceResult.value

  const runResult = await resolveIssueRun({
    db,
    workspaceId,
    runIdOrIssueIdentifier,
  })
  if (runResult.isErr()) return readRunErr(runResult.error)
  const run = runResult.value

  const statusResult = parseRunStatus(run.status)
  if (statusResult.isErr()) return readRunErr(statusResult.error)

  const latestEventResult = await latestRunEvent({
    db,
    workspaceId,
    runId: run.id,
  })
  if (latestEventResult.isErr()) return readRunErr(latestEventResult.error)

  const questionEventResult = await latestRunEvent({
    db,
    workspaceId,
    runId: run.id,
    eventType: 'issue_run:input_requested',
  })
  if (questionEventResult.isErr()) return readRunErr(questionEventResult.error)

  const approvalEventResult = await latestRunEvent({
    db,
    workspaceId,
    runId: run.id,
    eventType: 'issue_run:approval_requested',
  })
  if (approvalEventResult.isErr()) return readRunErr(approvalEventResult.error)

  const workProductsResult = await listRunWorkProducts({
    db,
    workspaceId,
    runId: run.id,
  })
  if (workProductsResult.isErr()) return readRunErr(workProductsResult.error)

  return Result.ok({
    status: statusResult.value,
    started_at: toIsoString(run.started_at),
    last_event_summary: eventSummary(latestEventResult.value),
    // Per-agent Durable Object plan RPC is not wired in this branch yet.
    plan: null,
    pending_question:
      statusResult.value === 'waiting_for_input'
        ? pendingQuestionFromEvent(questionEventResult.value)
        : null,
    pending_approval_preview:
      statusResult.value === 'waiting_for_approval'
        ? pendingApprovalFromEvent(approvalEventResult.value)
        : null,
    work_products_summary: workProductsResult.value.map((workProduct) => ({
      id: workProduct.id,
      type: workProduct.type,
      title: workProduct.title ?? workProduct.type,
      status: workProduct.status,
    })),
  })
}

async function createIssueFromChat(
  context: ChatIssueToolContext,
  input: z.infer<typeof createIssueInputSchema>,
): Promise<ResultValue<CreateIssueToolResult, string>> {
  const identityResult = await loadChatIssueIdentity(context)
  if (identityResult.isErr()) return Result.err(identityResult.error)
  const identity = identityResult.value

  const issueResult = await createIssueService({
    databaseUrl: context.databaseUrl,
    workspaceId: identity.workspaceId,
    title: input.title,
    description: input.description ?? null,
    status: 'backlog',
    priority: 'medium',
    createdBy: identity.ownerUserId,
    assigneeType: input.assignee_agent_id ? 'agent' : null,
    assigneeId: input.assignee_agent_id ?? null,
    source: input.source
      ? {
          connectorId: input.source.connector_id,
          sourceKind: input.source.source_kind,
          externalId: input.source.external_id,
          externalUrl: input.source.external_url,
        }
      : undefined,
  })
  if (issueResult.isErr()) return issueToolErr(issueResult.error.message)

  const issue = issueResult.value
  if (input.assignee_agent_id) {
    const startResult = await startIssueRun(
      { DATABASE_URL: context.databaseUrl },
      {
        workspaceId: identity.workspaceId,
        issueId: issue.id,
        agentId: input.assignee_agent_id,
        source: 'manual',
        actor: { type: 'agent', id: identity.agentId },
      },
    )
    if (startResult.isErr()) return issueToolErr(startResult.error.message)
  }

  return Result.ok({
    issue_id: issue.id,
    identifier: issue.identifier,
  })
}

async function readIssueFromChat(
  context: ChatIssueToolContext,
  issueIdOrIdentifier: string,
): Promise<ResultValue<IssueSummary, string>> {
  const identityResult = await loadChatIssueIdentity(context)
  if (identityResult.isErr()) return Result.err(identityResult.error)

  const issueResult = await readIssueService({
    databaseUrl: context.databaseUrl,
    workspaceId: identityResult.value.workspaceId,
    issueIdOrIdentifier,
  })
  if (issueResult.isErr()) return issueToolErr(issueResult.error.message)
  return Result.ok(issueResult.value)
}

async function listIssuesFromChat(
  context: ChatIssueToolContext,
  input: z.infer<typeof listIssuesInputSchema>,
): Promise<ResultValue<IssueSummary[], string>> {
  const identityResult = await loadChatIssueIdentity(context)
  if (identityResult.isErr()) return Result.err(identityResult.error)
  const identity = identityResult.value

  const issuesResult = await listIssuesService({
    databaseUrl: context.databaseUrl,
    workspaceId: identity.workspaceId,
    ownerUserId: identity.ownerUserId,
    assigneeAgentId: input.assignee_agent_id,
    status: input.status,
    mine: input.mine,
    limit: input.limit,
  })
  if (issuesResult.isErr()) return issueToolErr(issuesResult.error.message)
  return Result.ok(issuesResult.value)
}

async function postIssueCommentFromChat(
  context: ChatIssueToolContext,
  input: z.infer<typeof postIssueCommentInputSchema>,
): Promise<ResultValue<{ comment_id: string }, string>> {
  const identityResult = await loadChatIssueIdentity(context)
  if (identityResult.isErr()) return Result.err(identityResult.error)
  const identity = identityResult.value

  const commentResult = await postIssueCommentService({
    databaseUrl: context.databaseUrl,
    workspaceId: identity.workspaceId,
    issueIdOrIdentifier: input.issue_id_or_identifier,
    authorUserId: identity.ownerUserId,
    body: input.body,
  })
  if (commentResult.isErr()) return issueToolErr(commentResult.error.message)
  return Result.ok(commentResult.value)
}

export function createChatSubAgentTools({
  databaseUrl,
  threadId,
  workspace,
  loader,
  getSandbox,
}: ChatSubAgentToolsInput): ToolSet {
  const documentContext = (): DocumentToolContext | null =>
    databaseUrl && threadId
      ? { databaseUrl, workspace, threadId }
      : null
  const readRunContext = (): ReadRunToolContext | null =>
    databaseUrl && threadId ? { databaseUrl, threadId } : null
  const chatIssueContext = (): ChatIssueToolContext | null =>
    databaseUrl && threadId ? { databaseUrl, threadId } : null

  return {
    execute: createExecuteTool({
      tools: {},
      state: createWorkspaceStateBackend(workspace),
      loader,
    }),
    ...createSandboxTools(getSandbox),

    // Client-side tool — no execute function. The UI renders an interactive
    // StructuredInputPanel and sends the user's selections back via
    // addToolOutput. The model receives the answers as the tool result.
    askUserInput: tool({
      description:
        'Present the user with one or more structured questions to choose from before proceeding. ' +
        'Each question shows labelled options the user can pick. Returns a record mapping question id to selected label(s). ' +
        'Use this when you need the user to clarify direction, pick preferences, or confirm a choice — not for open-ended questions.',
      inputSchema: z.object({
        questions: z.array(
          z.object({
            id: z.string().describe('Unique identifier for this question'),
            header: z.string().optional().describe('Short uppercase section label shown above the question, e.g. TONE or FORMAT'),
            question: z.string().describe('The question to present'),
            options: z.array(
              z.object({
                label: z.string().describe('Option label'),
                description: z.string().optional().describe('Brief clarification shown beside the label'),
              }),
            ).min(2).describe('Available options'),
            multiSelect: z.boolean().optional().describe('Allow selecting multiple options (default false)'),
          }),
        ).min(1).describe('Questions to ask the user'),
      }),
    }),

    propose_agent: createProposeAgentTool({ databaseUrl, threadId }),

    create_issue: tool({
      description:
        'Create a Garden issue from chat. Optionally assign it to an agent and bind it to an external source. ' +
        'Use this when the user asks you to make, file, or save work as an issue.',
      inputSchema: createIssueInputSchema,
      execute: async (input) => {
        const context = chatIssueContext()
        if (!context) {
          return Result.serialize(
            Result.err<CreateIssueToolResult, string>(
              'create_issue: database tools are not configured.',
            ),
          )
        }
        return Result.serialize(await createIssueFromChat(context, input))
      },
    }),

    read_issue: tool({
      description:
        'Read a Garden issue summary for an issue identifier like ACC-43 or an issue UUID. ' +
        'Use this when the user asks what is happening with an issue or what an assigned agent is doing.',
      inputSchema: readIssueInputSchema,
      execute: async ({ issue_id_or_identifier }) => {
        const context = chatIssueContext()
        if (!context) {
          return Result.serialize(
            Result.err<IssueSummary, string>(
              'read_issue: database tools are not configured.',
            ),
          )
        }
        return Result.serialize(
          await readIssueFromChat(context, issue_id_or_identifier),
        )
      },
    }),

    list_issues: tool({
      description:
        'List Garden issue summaries in the current workspace. Filter by status, agent assignee, or issues assigned to the chat user.',
      inputSchema: listIssuesInputSchema,
      execute: async (input) => {
        const context = chatIssueContext()
        if (!context) {
          return Result.serialize(
            Result.err<IssueSummary[], string>(
              'list_issues: database tools are not configured.',
            ),
          )
        }
        return Result.serialize(await listIssuesFromChat(context, input))
      },
    }),

    post_issue_comment: tool({
      description:
        'Post a comment to a Garden issue as the chat user. This can wake the assigned or mentioned issue agent.',
      inputSchema: postIssueCommentInputSchema,
      execute: async (input) => {
        const context = chatIssueContext()
        if (!context) {
          return Result.serialize(
            Result.err<{ comment_id: string }, string>(
              'post_issue_comment: database tools are not configured.',
            ),
          )
        }
        return Result.serialize(await postIssueCommentFromChat(context, input))
      },
    }),

    // Example: "What's happening with ACC-43?"
    // → read_run("ACC-43")
    // → "Garden is on turn 3. It's waiting on you for one question: 'Should multi-org users get tenant filtering?' Drafted brief is up for review."
    read_run: tool({
      description:
        'Read live issue-run state for an issue identifier like ACC-43, or for a specific issue_run UUID. ' +
        'Use this when the user asks what is happening with an issue, whether an agent is blocked, or what is waiting on them.',
      inputSchema: readRunInputSchema,
      execute: async ({ run_id_or_issue_identifier }) => {
        const context = readRunContext()
        if (!context) {
          return Result.serialize(
            Result.err<ReadRunToolResult, string>(
              'read_run: database tools are not configured.',
            ),
          )
        }
        return Result.serialize(
          await readRun(context, run_id_or_issue_identifier),
        )
      },
    }),

    listDocuments: tool({
      description:
        'List the documents available in this chat/workspace. Use this before reading, searching, or editing when the user refers to a document by name.',
      inputSchema: z.object({}),
      execute: async () => {
        const context = documentContext()
        if (!context) {
          return { ok: false, error: 'Document tools are not configured.' }
        }
        return await listDocuments(context)
      },
    }),

    readDocument: tool({
      description:
        'Read the full text content of a document. Always call this before answering questions about, summarizing, citing, or editing a document.',
      inputSchema: z.object({
        documentId: z
          .string()
          .uuid()
          .describe(
            'Internal document handle to read. Never show this value to the user.',
          ),
      }),
      execute: async ({ documentId }) => {
        const context = documentContext()
        if (!context) {
          return { ok: false, error: 'Document tools are not configured.' }
        }
        return await readDocument({ context, documentId })
      },
    }),

    findInDocument: tool({
      description:
        'Search for specific strings inside a document. Matching is case-insensitive and whitespace-tolerant. Use this for targeted lookups instead of reading a whole document.',
      inputSchema: z.object({
        documentId: z
          .string()
          .uuid()
          .describe(
            'Internal document handle to search. Never show this value to the user.',
          ),
        query: z.string().min(1),
        maxResults: z.number().int().positive().max(100).optional(),
        contextChars: z.number().int().positive().max(1000).optional(),
      }),
      execute: async ({ documentId, query, maxResults, contextChars }) => {
        const context = documentContext()
        if (!context) {
          return { ok: false, error: 'Document tools are not configured.' }
        }
        return await findInDocument({
          context,
          documentId,
          query,
          maxResults,
          contextChars,
        })
      },
    }),

    generateDocx: tool({
      description:
        'Generate a Word (.docx) document from structured content. Use when the user asks to draft, create, write, or produce a document. Section content supports **bold** and *italic* inline markdown plus simple "- " or "* " bullet lines. Returns a first-class document artifact.',
      inputSchema: z.object({
        title: z
          .string()
          .min(1)
          .describe('Document title, also used for filename.'),
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
              .enum(['letter', 'a4'])
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
              .describe('Optional running header text shown on every page.'),
            footer: z
              .string()
              .optional()
              .describe('Optional running footer text shown on every page.'),
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
        const context = documentContext()
        if (!context) {
          return { ok: false, error: 'Document tools are not configured.' }
        }
        return await generateDocx({
          context,
          title,
          sections,
          landscape,
          options,
        })
      },
    }),

    editDocument: tool({
      description:
        'Propose tracked changes to a .docx document. Use readDocument first. Each edit must be a precise substitution with context_before and context_after so it can be located unambiguously. Returns edit annotations and a new document artifact version.',
      inputSchema: z.object({
        documentId: z
          .string()
          .uuid()
          .describe(
            'Internal document handle to edit. Never show this value to the user.',
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
        const context = documentContext()
        if (!context) {
          return { ok: false, error: 'Document tools are not configured.' }
        }
        return await editDocument({ context, documentId, edits })
      },
    }),

    convertDocumentToPdf: tool({
      description:
        'Convert an existing DOC/DOCX document to a PDF artifact by running LibreOffice in the sandbox/code-execution environment, then storing the PDF back into this agent workspace.',
      inputSchema: z.object({
        documentId: z
          .string()
          .uuid()
          .describe(
            'Internal source document handle. Never show this value to the user.',
          ),
      }),
      execute: async ({ documentId }) => {
        const context = documentContext()
        if (!context) {
          return { ok: false, error: 'Document tools are not configured.' }
        }
        const source = await getDocumentBytes({ context, documentId })
        if (!source.ok) return source
        if (!source.bytes) {
          return { ok: false, error: 'Source document bytes not found.' }
        }
        const sourceFilename = source.filename ?? 'document.docx'
        const stem = sourceFilename.replace(/\.[^.]+$/, '') || 'document'
        const dir = `/workspace/.scratch/document-convert/${documentId}`
        const inputBase64Path = `${dir}/input.b64`
        const inputPath = `${dir}/${sourceFilename}`
        const outputPath = `${dir}/${stem}.pdf`
        const sandbox = getSandbox()
        await sandbox.mkdir(dir, { recursive: true })
        await sandbox.writeFile(
          inputBase64Path,
          Buffer.from(source.bytes).toString('base64'),
        )
        const command = [
          `base64 -d ${shellQuote(inputBase64Path)} > ${shellQuote(inputPath)}`,
          `(libreoffice --headless --convert-to pdf --outdir ${shellQuote(dir)} ${shellQuote(inputPath)} || soffice --headless --convert-to pdf --outdir ${shellQuote(dir)} ${shellQuote(inputPath)})`,
        ].join(' && ')
        const result = await sandbox.exec(command)
        if (!result.success) {
          return {
            ok: false,
            error:
              result.stderr ||
              result.stdout ||
              'LibreOffice conversion failed in sandbox.',
          }
        }
        const pdf = await sandbox.readFile(outputPath, { encoding: 'base64' })
        if (!pdf.success || !pdf.content) {
          return { ok: false, error: 'Converted PDF could not be read.' }
        }
        return await registerUploadedDocument({
          context,
          filename: `${stem}.pdf`,
          mediaType: 'application/pdf',
          bytes: Buffer.from(pdf.content, 'base64'),
        })
      },
    }),

  }
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
