// Measures the context-window cost of the chat and issue agents' tool schemas.
//
// For each tool we serialize what an Anthropic-style request actually carries:
//   { name, description, input_schema }
// and sum the resulting JSON byte counts. We then estimate tokens as chars/3.5
// (a fair English heuristic; actual counts vary by tokenizer).
//
// Local tools come from the agent-runtime sources. MCP/connector tools are
// pulled live from the upstream MCP servers via tools/list.

import { execFileSync } from 'node:child_process'
import { Result } from 'better-result'
import { z } from 'zod'

type ToolEntry = {
  group: string
  name: string
  description: string
  inputSchema: unknown
  bytes: number
}

const CHAT_LOCAL_TOOLS: Array<Pick<ToolEntry, 'name' | 'description' | 'inputSchema'>> = []
const ISSUE_LOCAL_TOOLS: Array<Pick<ToolEntry, 'name' | 'description' | 'inputSchema'>> = []

// ──────────────────────────────────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────────────────────────────────

function describeBytes(bytes: number) {
  return `${bytes.toLocaleString()} chars  (~${Math.round(bytes / 3.5).toLocaleString()} tokens)`
}

function toJSON(value: unknown) {
  return JSON.stringify(value)
}

function entryBytes(name: string, description: string, inputSchema: unknown) {
  return toJSON({ name, description, input_schema: inputSchema }).length
}

// ──────────────────────────────────────────────────────────────────────────
// Local tool schemas
// Reproduced from packages/agent-runtime/src/* — Zod schemas converted to
// JSON Schema via z.toJSONSchema. We re-declare the schemas here so we don't
// have to bring up a Cloudflare DO runtime just to count bytes.
// ──────────────────────────────────────────────────────────────────────────

function reg(
  group: 'chat' | 'issue',
  name: string,
  description: string,
  schema: z.ZodTypeAny | unknown,
) {
  const inputSchema =
    schema && (schema as z.ZodTypeAny)._def
      ? z.toJSONSchema(schema as z.ZodTypeAny)
      : schema
  if (group === 'chat') {
    CHAT_LOCAL_TOOLS.push({ name, description, inputSchema })
  } else {
    ISSUE_LOCAL_TOOLS.push({ name, description, inputSchema })
  }
}

// ── Workspace tools (createWorkspaceTools) — both agents get these ──────
const WORKSPACE_TOOL_SCHEMAS: Array<{ name: string; description: string; schema: z.ZodTypeAny }> = [
  {
    name: 'read',
    description:
      'Read a file from the workspace. Returns text content, with optional line offset/limit. Use this to inspect files before editing.',
    schema: z.object({
      path: z.string(),
      offset: z.number().int().optional(),
      limit: z.number().int().optional(),
    }),
  },
  {
    name: 'write',
    description:
      'Write a file to the workspace, creating or replacing it. Use clear paths and prefer to read first.',
    schema: z.object({ path: z.string(), content: z.string() }),
  },
  {
    name: 'edit',
    description:
      'Replace an exact substring in a file. Provide old_string with enough context to be unique; the tool errors if not unique.',
    schema: z.object({
      path: z.string(),
      old_string: z.string(),
      new_string: z.string(),
    }),
  },
  {
    name: 'list',
    description: 'List entries in a directory of the workspace.',
    schema: z.object({
      path: z.string(),
      limit: z.number().int().optional(),
      offset: z.number().int().optional(),
    }),
  },
  {
    name: 'find',
    description: 'Glob for paths in the workspace using a pattern like "**/*.ts".',
    schema: z.object({ pattern: z.string() }),
  },
  {
    name: 'grep',
    description:
      'Search file contents in the workspace. Supports include filters, case sensitivity, and context lines.',
    schema: z.object({
      query: z.string(),
      include: z.string().optional(),
      fixedString: z.boolean().optional(),
      caseSensitive: z.boolean().optional(),
      contextLines: z.number().int().optional(),
    }),
  },
  {
    name: 'delete',
    description: 'Delete a file or directory in the workspace.',
    schema: z.object({ path: z.string(), recursive: z.boolean().optional() }),
  },
]

for (const tool of WORKSPACE_TOOL_SCHEMAS) {
  reg('chat', tool.name, tool.description, tool.schema)
  reg('issue', tool.name, tool.description, tool.schema)
}

// ── Sandbox tools (createSandboxTools) — both agents get these ──────────
const SANDBOX_TOOL_SCHEMAS: Array<{ name: string; description: string; schema: z.ZodTypeAny }> = [
  {
    name: 'sandboxExec',
    description:
      'Run a shell command inside the persistent sandbox workspace. Use this for one-off scripts, tests, package installs, build commands, and inspecting files. Commands run in /workspace by default. Shell state is not guaranteed between calls, so pass cwd instead of depending on cd.',
    schema: z.object({
      command: z.string().min(1),
      cwd: z.string().optional(),
      timeoutMs: z.number().int().positive().max(120_000).optional(),
    }),
  },
  {
    name: 'sandboxRunCode',
    description:
      'Run Python, JavaScript, or TypeScript code inside the sandbox interpreter. Use this for data/document processing, quick calculations, and short snippets that benefit from structured interpreter results. Prefer sandboxExec for scripts that should be saved as artifacts.',
    schema: z.object({
      code: z.string().min(1),
      language: z.enum(['python', 'javascript', 'typescript']).default('python'),
      timeoutMs: z.number().int().positive().max(120_000).optional(),
    }),
  },
  {
    name: 'sandboxReadFile',
    description: 'Read a UTF-8 file from the sandbox workspace. Paths are scoped to /workspace.',
    schema: z.object({ path: z.string().min(1) }),
  },
  {
    name: 'sandboxWriteFile',
    description:
      'Write a UTF-8 file into the sandbox workspace, creating or replacing the file. Use clear paths under /workspace; use /workspace/.scratch for temporary working files.',
    schema: z.object({ path: z.string().min(1), content: z.string() }),
  },
  {
    name: 'sandboxListFiles',
    description: 'List files in the sandbox workspace. Paths are scoped to /workspace.',
    schema: z.object({
      path: z.string().optional(),
      recursive: z.boolean().optional(),
      includeHidden: z.boolean().optional(),
    }),
  },
  {
    name: 'sandboxStartProcess',
    description:
      'Start a long-running process inside the sandbox, such as a dev server. Use sandboxListProcesses and sandboxKillProcess to manage it, and expose the port when the user should inspect the result.',
    schema: z.object({ command: z.string().min(1), cwd: z.string().optional() }),
  },
  {
    name: 'sandboxListProcesses',
    description: 'List running and recently completed processes inside the sandbox.',
    schema: z.object({}),
  },
  {
    name: 'sandboxKillProcess',
    description: 'Terminate a process that was started inside the sandbox.',
    schema: z.object({ processId: z.string().min(1) }),
  },
  {
    name: 'sandboxExposePort',
    description:
      'Expose a service running inside the sandbox and return its preview URL. Use this after starting a web server process for an HTML app, generated artifact, or previewable tool.',
    schema: z.object({
      port: z.number().int().positive().max(65_535),
      hostname: z.string().min(1),
    }),
  },
]

for (const tool of SANDBOX_TOOL_SCHEMAS) {
  reg('chat', tool.name, tool.description, tool.schema)
  reg('issue', tool.name, tool.description, tool.schema)
}

// ── execute (codemode-style filesystem-only) — both agents get this ─────
{
  const description =
    'Run JavaScript in the sandbox for multi-step filesystem work. Use state.readFile(path), state.writeFile(path, content), state.glob(pattern), state.readDir(path), state.mkdir(path), state.rm(path), state.cp(from, to), and state.mv(from, to). Input is an async arrow function body as JavaScript, not TypeScript. Return the useful result.'
  // codemode passes a generated typed surface back; description includes the
  // {{types}} block in real usage. We measure the description-only baseline
  // because the dynamic types portion only gets large when `tools` is
  // non-empty (right now it's `tools: {}`).
  const schema = z.object({ code: z.string() })
  reg('chat', 'execute', description, schema)
  reg('issue', 'execute', description, schema)
}

// ── Chat-specific business tools ────────────────────────────────────────
const CHAT_TOOLS: Array<{ name: string; description: string; schema: z.ZodTypeAny }> = [
  {
    name: 'askUserInput',
    description:
      'Present the user with one or more structured questions to choose from before proceeding. Each question shows labelled options the user can pick. Returns a record mapping question id to selected label(s). Use this when you need the user to clarify direction, pick preferences, or confirm a choice — not for open-ended questions.',
    schema: z.object({
      questions: z.array(
        z.object({
          id: z.string(),
          header: z.string().optional(),
          question: z.string(),
          options: z
            .array(z.object({ label: z.string(), description: z.string().optional() }))
            .min(2),
          multiSelect: z.boolean().optional(),
        }),
      ).min(1),
    }),
  },
  {
    name: 'propose_agent',
    description:
      'Propose a new workspace agent for the user to approve. Use only when the workspace clearly needs a reusable role that no existing agent fills. Include a name, role title, instructions, and any required skills/connectors.',
    schema: z.object({
      name: z.string(),
      role_title: z.string(),
      description: z.string(),
      instructions: z.string(),
      requested_skills: z.array(z.string()).optional(),
      requested_connectors: z.array(z.string()).optional(),
    }),
  },
  {
    name: 'create_issue',
    description:
      'Create a Garden issue from chat. Optionally assign it to an agent and bind it to an external source. Use assignee_agent_id when the user asks for an agent to do the work; assigned issues start immediately in todo. Before assigning, list workspace agents and choose an existing active agent; the current agent is a valid assignee when it is the right owner.',
    schema: z.object({
      title: z.string(),
      description: z.string().trim().min(1).optional(),
      assignee_agent_id: z.string().uuid().optional(),
      source: z
        .object({
          connector_id: z.string(),
          source_kind: z.string(),
          external_id: z.string(),
          external_url: z.string().trim().min(1).optional(),
        })
        .strict()
        .optional(),
    }).strict(),
  },
  {
    name: 'assign_issue',
    description:
      'Assign an existing Garden issue to an active workspace agent and start that agent immediately. Use this when the user says to assign, start, hand off, or wake an agent for an issue that already exists. Before assigning, list workspace agents and choose an existing active agent; the current agent is a valid assignee when it is the right owner.',
    schema: z
      .object({
        issue_id_or_identifier: z.string().min(1),
        assignee_agent_id: z.string().uuid(),
      })
      .strict(),
  },
  {
    name: 'list_workspace_inventory',
    description:
      'List bounded current workspace inventory. Defaults to agents only; request skills/connectors only when needed. Use before assigning work, proposing an agent, or mentioning skills/connectors when the current workspace inventory matters. Use current_agent_id for self-assignment when appropriate.',
    schema: z
      .object({
        include: z.array(z.enum(['agents', 'skills', 'connectors'])).max(3).optional(),
        query: z.string().trim().min(1).optional(),
        limit: z.number().int().positive().max(50).optional(),
      })
      .strict(),
  },
  {
    name: 'read_issue',
    description:
      'Read a Garden issue summary for an issue identifier like ISS-43 or an issue UUID. Use this when the user asks what is happening with an issue or what an assigned agent is doing.',
    schema: z.object({ issue_id_or_identifier: z.string().min(1) }).strict(),
  },
  {
    name: 'update_issue_status',
    description:
      'Update a Garden issue status in the current workspace. Use status done when the user says complete, resolve, or mark done. Use cancelled when the user says cancel, drop, or stop. If the user only says close and context does not make done vs cancelled clear, ask a clarification question instead of guessing. This is for Garden issues only; do not use GitHub issue tools unless the user explicitly names GitHub or asks to update an external GitHub issue.',
    schema: z
      .object({
        issue_id_or_identifier: z.string().min(1),
        status: z.enum(['todo', 'in_progress', 'in_review', 'done', 'cancelled', 'blocked']),
      })
      .strict(),
  },
  {
    name: 'list_issues',
    description:
      'List Garden issue summaries in the current workspace. Filter by status, agent assignee, or issues assigned to the chat user.',
    schema: z
      .object({
        assignee_agent_id: z.string().uuid().optional(),
        status: z
          .enum(['todo', 'in_progress', 'in_review', 'done', 'cancelled', 'blocked'])
          .optional(),
        mine: z.boolean().optional(),
        limit: z.number().int().positive().max(100).optional(),
      })
      .strict(),
  },
  {
    name: 'post_issue_comment',
    description:
      'Post a comment to a Garden issue as the chat user. This can wake the assigned or mentioned issue agent.',
    schema: z
      .object({ issue_id_or_identifier: z.string().min(1), body: z.string().min(1) })
      .strict(),
  },
  {
    name: 'read_run',
    description:
      'Read live issue-run state for an issue identifier like ISS-43, or for a specific issue_run UUID. Use this when the user asks what is happening with an issue, whether an agent is blocked, or what is waiting on them.',
    schema: z
      .object({ run_id_or_issue_identifier: z.string().min(1) })
      .strict(),
  },
  {
    name: 'listDocuments',
    description:
      'List the documents available in this chat/workspace. Use this before reading, searching, or editing when the user refers to a document by name.',
    schema: z.object({}),
  },
  {
    name: 'readDocument',
    description:
      'Read the full text content of a document. Always call this before answering questions about, summarizing, citing, or editing a document.',
    schema: z.object({ documentId: z.string().uuid() }),
  },
  {
    name: 'findInDocument',
    description:
      'Search for specific strings inside a document. Matching is case-insensitive and whitespace-tolerant. Use this for targeted lookups instead of reading a whole document.',
    schema: z.object({
      documentId: z.string().uuid(),
      query: z.string().min(1),
      maxResults: z.number().int().positive().max(100).optional(),
      contextChars: z.number().int().positive().max(1000).optional(),
    }),
  },
  {
    name: 'generateDocx',
    description:
      'Generate a Word (.docx) document from structured content. Use when the user asks to draft, create, write, or produce a document. Section content supports **bold** and *italic* inline markdown plus simple "- " or "* " bullet lines. Returns a first-class document artifact.',
    schema: z.object({
      title: z.string().min(1),
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
          pageSize: z.enum(['letter', 'a4']).optional(),
          font: z.string().optional(),
          header: z.string().optional(),
          footer: z.string().optional(),
          pageNumbers: z.boolean().optional(),
        })
        .optional(),
    }),
  },
  {
    name: 'editDocument',
    description:
      'Propose tracked changes to a .docx document. Use readDocument first. Each edit must be a precise substitution with context_before and context_after so it can be located unambiguously. Returns edit annotations and a new document artifact version.',
    schema: z.object({
      documentId: z.string().uuid(),
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
  },
  {
    name: 'convertDocumentToPdf',
    description:
      'Convert an existing DOC/DOCX document to a PDF artifact by running LibreOffice in the sandbox/code-execution environment, then storing the PDF back into this agent workspace.',
    schema: z.object({ documentId: z.string().uuid() }),
  },
]

for (const tool of CHAT_TOOLS) {
  reg('chat', tool.name, tool.description, tool.schema)
  reg('issue', tool.name, tool.description, tool.schema)
}

// ── Issue-only resolution tools (added on top of chat tools) ────────────
const ISSUE_TOOLS: Array<{ name: string; description: string; schema: z.ZodTypeAny }> = [
  {
    name: 'update_plan',
    description:
      'Update the live plan for this issue run. Plans are short todo lists with statuses (pending, in_progress, completed). Always update the plan before and after meaningful work; collapse it to one in_progress at a time.',
    schema: z.object({
      plan: z.array(
        z.object({
          content: z.string(),
          activeForm: z.string(),
          status: z.enum(['pending', 'in_progress', 'completed']),
        }),
      ),
    }),
  },
  {
    name: 'post_comment',
    description:
      'Post a comment on the issue from this agent. Use sparingly: only to surface decisions, summarize work, or escalate blockers. Do not narrate every step.',
    schema: z.object({ body: z.string().min(1) }),
  },
  {
    name: 'ask_question',
    description:
      'Pause the run and ask the user a focused clarifying question with labelled options. Returns the user\'s answer when the run resumes. Use only when you cannot make a reasonable decision from existing context.',
    schema: z.object({
      question: z.string().min(1),
      options: z
        .array(z.object({ label: z.string(), description: z.string().optional() }))
        .min(2),
      multiSelect: z.boolean().optional(),
    }),
  },
  {
    name: 'create_work_product',
    description:
      'Create a new work product (deliverable) for this issue. Choose a type, title, and body. Work products are how this run produces concrete output for the user.',
    schema: z.object({
      type: z.string(),
      title: z.string(),
      body: z.string(),
      review_state: z.enum(['draft', 'ready_for_review', 'final']).optional(),
    }),
  },
  {
    name: 'revise_work_product',
    description:
      'Revise an existing work product on this issue, producing a new version. Always call create or revise rather than dumping raw output as a comment.',
    schema: z.object({
      work_product_id: z.string().uuid(),
      title: z.string().optional(),
      body: z.string(),
      review_state: z.enum(['draft', 'ready_for_review', 'final']).optional(),
    }),
  },
  {
    name: 'mark_blocked',
    description:
      'Mark this issue as blocked with a short reason describing what is needed to unblock it. Use this when external input is required and asking would not resolve it within this run.',
    schema: z.object({ reason: z.string().min(1) }),
  },
  {
    name: 'create_child_issue',
    description:
      'Decompose this issue into a child issue for parallel or follow-up work. Use a clear short title and link the most relevant sources.',
    schema: z.object({
      title: z.string(),
      description: z.string().optional(),
      assignee_agent_id: z.string().uuid().optional(),
    }),
  },
  {
    name: 'attach_source_binding',
    description:
      'Attach an external source (e.g. github pull_request, slack thread, gmail email_thread, drive file) to this issue so future runs and the user can cross-reference.',
    schema: z.object({
      connector_id: z.string(),
      source_kind: z.string(),
      external_id: z.string(),
      external_url: z.string().optional(),
      display_ref: z.string().optional(),
    }),
  },
  {
    name: 'read_source',
    description:
      'Read the latest content of an attached external source (e.g. a github PR, slack thread, gmail email, drive file) by its source binding id.',
    schema: z.object({ source_binding_id: z.string().uuid() }),
  },
]

for (const tool of ISSUE_TOOLS) {
  reg('issue', tool.name, tool.description, tool.schema)
}

// ──────────────────────────────────────────────────────────────────────────
// Live MCP fetchers (per connector)
// ──────────────────────────────────────────────────────────────────────────

type McpTool = {
  name: string
  description?: string
  inputSchema?: unknown
}

async function listMcpTools(args: {
  url: string
  headers: Record<string, string>
  toolsetsHeader?: string | null
}): Promise<McpTool[]> {
  const baseHeaders: Record<string, string> = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    ...args.headers,
  }
  if (args.toolsetsHeader) {
    baseHeaders['x-mcp-toolsets'] = args.toolsetsHeader
  }

  async function post(body: unknown, sessionId?: string) {
    const headers = { ...baseHeaders } as Record<string, string>
    if (sessionId) headers['mcp-session-id'] = sessionId
    return await fetch(args.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  }

  const initResp = await post({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'garden-measure', version: '0.0.0' },
    },
  })
  const sessionId = initResp.headers.get('mcp-session-id') ?? undefined
  if (!initResp.ok) {
    throw new Error(`initialize failed (${initResp.status}): ${await initResp.text()}`)
  }
  await initResp.text() // drain

  await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId)
  const listResp = await post(
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    sessionId,
  )
  const text = await listResp.text()
  const dataLine =
    text.split('\n').find((line) => line.startsWith('data: '))?.slice('data: '.length) ?? text
  if (!listResp.ok) {
    throw new Error(`tools/list failed (${listResp.status}): ${text}`)
  }
  const parsed = JSON.parse(dataLine) as { result?: { tools?: McpTool[] } }
  return parsed.result?.tools ?? []
}

async function fetchExaTools(): Promise<McpTool[]> {
  return await listMcpTools({
    url: 'https://mcp.exa.ai/mcp?tools=web_search_exa,web_fetch_exa',
    headers: {},
  })
}

async function fetchGithubTools(): Promise<McpTool[]> {
  // Reuse the same GitHub App / gh-cli token resolution as check-github-mcp.ts.
  let token = process.env.GITHUB_TOKEN?.trim()
  if (!token) {
    token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim()
  }
  return await listMcpTools({
    url: 'https://api.githubcopilot.com/mcp/',
    headers: { authorization: `Bearer ${token}` },
    toolsetsHeader: 'repos,issues,pull_requests',
  })
}

// Gmail / Slack / Google-Drive go through workspace OAuth + Garden's MCP proxy
// at runtime. Without a workspace OAuth context we can't authenticate; we fall
// back to the registry tool count and use a per-tool size estimate calibrated
// from GitHub MCP (typical Anthropic-style schema ~600–900 chars). The
// estimate is reported separately so it's clear what's measured vs estimated.
const REGISTRY_TOOL_COUNTS: Record<string, number> = {
  gmail: 10,
  'google-drive': 7,
  slack: 10,
}
let GITHUB_AVG_TOOL_BYTES: number | null = null

// ──────────────────────────────────────────────────────────────────────────
// Reporting
// ──────────────────────────────────────────────────────────────────────────

type Section = {
  group: string
  tools: ToolEntry[]
}

function summarize(name: string, sections: Section[]) {
  let totalBytes = 0
  let totalTools = 0
  console.log(`\n=== ${name} ===`)
  for (const section of sections) {
    const sectionBytes = section.tools.reduce((acc, tool) => acc + tool.bytes, 0)
    totalBytes += sectionBytes
    totalTools += section.tools.length
    console.log(
      `  ${section.group.padEnd(28)} ${section.tools.length
        .toString()
        .padStart(3)} tools  ${describeBytes(sectionBytes)}`,
    )
  }
  console.log(
    `  ${'TOTAL'.padEnd(28)} ${totalTools.toString().padStart(3)} tools  ${describeBytes(totalBytes)}`,
  )
  return { totalTools, totalBytes }
}

function entriesFromLocal(
  group: string,
  tools: Array<Pick<ToolEntry, 'name' | 'description' | 'inputSchema'>>,
): ToolEntry[] {
  return tools.map((tool) => ({
    group,
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    bytes: entryBytes(tool.name, tool.description, tool.inputSchema),
  }))
}

function entriesFromMcp(group: string, tools: McpTool[]): ToolEntry[] {
  return tools.map((tool) => ({
    group,
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
    bytes: entryBytes(tool.name, tool.description ?? '', tool.inputSchema ?? {}),
  }))
}

function buildLocalSections(
  group: 'chat' | 'issue',
): Section[] {
  const tools = group === 'chat' ? CHAT_LOCAL_TOOLS : ISSUE_LOCAL_TOOLS
  const wsCount = WORKSPACE_TOOL_SCHEMAS.length
  const sandboxCount = SANDBOX_TOOL_SCHEMAS.length
  const executeCount = 1
  const businessChatCount = CHAT_TOOLS.length
  const issueOnlyCount = ISSUE_TOOLS.length

  const all = entriesFromLocal(group, tools)
  let cursor = 0
  const slice = (n: number, label: string): Section => {
    const subset = all.slice(cursor, cursor + n)
    cursor += n
    return { group: label, tools: subset }
  }

  const sections: Section[] = [
    slice(wsCount, 'workspace (think)'),
    slice(sandboxCount, 'sandbox'),
    slice(executeCount, 'execute (codemode-fs)'),
    slice(businessChatCount, 'chat business tools'),
  ]
  if (group === 'issue') {
    sections.push(slice(issueOnlyCount, 'issue-only resolution'))
  }
  return sections
}

async function main() {
  // Connector tools (live MCP)
  const exaResult = await Result.tryPromise<McpTool[], string>({
    try: async () => await fetchExaTools(),
    catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
  })
  const githubResult = await Result.tryPromise<McpTool[], string>({
    try: async () => await fetchGithubTools(),
    catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
  })

  if (githubResult.isOk()) {
    const sectionEntries = entriesFromMcp('github (mcp, live)', githubResult.value)
    const total = sectionEntries.reduce((acc, t) => acc + t.bytes, 0)
    GITHUB_AVG_TOOL_BYTES = sectionEntries.length > 0 ? total / sectionEntries.length : null
  }

  const exaEntries: ToolEntry[] = exaResult.isOk()
    ? entriesFromMcp('exa-search (mcp, live)', exaResult.value)
    : []
  const githubEntries: ToolEntry[] = githubResult.isOk()
    ? entriesFromMcp('github (mcp, live)', githubResult.value)
    : []

  const estimateBytes =
    GITHUB_AVG_TOOL_BYTES ??
    (exaEntries.length > 0
      ? exaEntries.reduce((acc, t) => acc + t.bytes, 0) / exaEntries.length
      : 800)

  const synthEntry = (group: string, name: string, bytes: number): ToolEntry => ({
    group,
    name,
    description: '<estimated from GitHub MCP avg>',
    inputSchema: null,
    bytes: Math.round(bytes),
  })

  const gmailEntries: ToolEntry[] = Array.from({ length: REGISTRY_TOOL_COUNTS.gmail }, (_, i) =>
    synthEntry('gmail (estimated)', `gmail_tool_${i + 1}`, estimateBytes),
  )
  const driveEntries: ToolEntry[] = Array.from(
    { length: REGISTRY_TOOL_COUNTS['google-drive'] },
    (_, i) => synthEntry('google-drive (estimated)', `drive_tool_${i + 1}`, estimateBytes),
  )
  const slackEntries: ToolEntry[] = Array.from({ length: REGISTRY_TOOL_COUNTS.slack }, (_, i) =>
    synthEntry('slack (estimated)', `slack_tool_${i + 1}`, estimateBytes),
  )

  const connectorSections: Section[] = [
    { group: 'exa-search', tools: exaEntries },
    { group: 'github', tools: githubEntries },
    { group: 'gmail (est.)', tools: gmailEntries },
    { group: 'google-drive (est.)', tools: driveEntries },
    { group: 'slack (est.)', tools: slackEntries },
  ]

  console.log('Connector / MCP tool sources:')
  console.log(`  exa-search:    ${exaResult.isOk() ? `live (${exaEntries.length})` : `failed (${exaResult.error})`}`)
  console.log(`  github:        ${githubResult.isOk() ? `live (${githubEntries.length})` : `failed (${githubResult.error})`}`)
  console.log(`  gmail:         estimated (${gmailEntries.length} tools × ~${Math.round(estimateBytes)} chars)`)
  console.log(`  google-drive:  estimated (${driveEntries.length} tools × ~${Math.round(estimateBytes)} chars)`)
  console.log(`  slack:         estimated (${slackEntries.length} tools × ~${Math.round(estimateBytes)} chars)`)

  // Chat agent
  const chatLocalSections = buildLocalSections('chat')
  const chatTotal = summarize('CHAT AGENT', [...chatLocalSections, ...connectorSections])

  // Issue agent
  const issueLocalSections = buildLocalSections('issue')
  const issueTotal = summarize('ISSUE AGENT', [...issueLocalSections, ...connectorSections])

  // Code-mode comparison: in code mode the model sees ONE tool whose
  // description embeds TypeScript type definitions of every codemode.* fn.
  // Type defs are roughly 1/3 the size of a JSON-Schema tool definition
  // because they drop $schema/required/properties wrappers and use TS types.
  // We use a 0.35 multiplier as an empirically-grounded conservative estimate.
  const codemodeFactor = 0.35
  console.log('\n=== CODE MODE PROJECTION (rough) ===')
  console.log(`  factor used: ${codemodeFactor} (fraction of full tool-schema bytes)`)
  console.log(
    `  chat agent:  ${describeBytes(Math.round(chatTotal.totalBytes * codemodeFactor))}`,
  )
  console.log(
    `  issue agent: ${describeBytes(Math.round(issueTotal.totalBytes * codemodeFactor))}`,
  )
  console.log(
    `  savings:     ~${Math.round((1 - codemodeFactor) * 100)}% of tool-schema bytes`,
  )

  // Anthropic context window context: 200k tokens. Print a % share.
  const contextWindow = 200_000
  console.log('\n=== AGAINST 200K CONTEXT WINDOW ===')
  console.log(
    `  chat agent  tools: ~${(((chatTotal.totalBytes / 3.5) / contextWindow) * 100).toFixed(2)}% of 200k`,
  )
  console.log(
    `  issue agent tools: ~${(((issueTotal.totalBytes / 3.5) / contextWindow) * 100).toFixed(2)}% of 200k`,
  )
}

const result = await Result.tryPromise({
  try: main,
  catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
})

if (result.isErr()) {
  console.error(result.error.message)
  process.exit(1)
}
