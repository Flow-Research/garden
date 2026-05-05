import { Result, type Result as ResultValue } from 'better-result'
import { tool } from 'ai'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getConnectorById } from '@garden/connectors'
import { classifyConnectorError } from '@garden/core/connectors/errors'
import * as schema from '@garden/db/schema'
import {
  appendIssueRunEvent,
  connectorToolError,
  dbError,
  getIssueRunDb,
  IssueRunToolError,
  requireRunState,
  toolErrorResult,
  toolOkResult,
  type IssueRunMcpToolRecord,
  type IssueRunToolContext,
} from './issue-run-tool-context'
import { normalizeMcpConnectorId } from '../mcp-connectors'

const readToolByConnectorAndKind: Record<string, Record<string, string>> = {
  github: {
    issue: 'issue_read',
    pull_request: 'pull_request_read',
  },
  slack: {
    message: 'slack_read_thread',
    thread: 'slack_read_thread',
  },
  gmail: {
    email_thread: 'get_thread',
  },
  'google-drive': {
    file: 'read_file_content',
  },
  'exa-search': {
    search_result: 'web_fetch_exa',
  },
}

export const readSourceInputSchema = z
  .object({
    binding_id: z.string().uuid().optional(),
  })
  .strict()

type SourceBindingRow = typeof schema.issueSourceBinding.$inferSelect

type ReadSourceResult = {
  binding_id: string
  connector_id: string
  mcp_connector_id: string
  source_kind: string
  external_id: string
  external_url: string | null
  tool: string
  content: string | null
  payload: unknown
}

function objectOrNull(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) ? parsed : null
}

function textFromMcpResult(result: unknown) {
  const object = objectOrNull(result)
  const content = Array.isArray(object?.content) ? object.content : []
  const text = content
    .flatMap((item) => {
      const part = objectOrNull(item)
      return part?.type === 'text' && typeof part.text === 'string'
        ? [part.text]
        : []
    })
    .join('\n')
    .trim()

  return text || null
}

function readToolForBinding(binding: SourceBindingRow) {
  const connectorId = normalizeMcpConnectorId(binding.connectorId)
  return readToolByConnectorAndKind[connectorId]?.[binding.sourceKind] ?? null
}

function parseGithubRef(binding: SourceBindingRow) {
  const raw = binding.externalUrl || binding.externalId
  const url = Result.try({
    try: () => new URL(raw),
    catch: () => null,
  })

  if (url.isOk() && url.value?.hostname.endsWith('github.com')) {
    const [owner, repo, kind, number] = url.value.pathname
      .split('/')
      .filter(Boolean)
    const parsedNumber = numberValue(number)
    return owner && repo && kind && parsedNumber !== null
      ? { owner, repo, kind, number: parsedNumber }
      : null
  }

  const match = raw.match(
    /^([^/\s]+)\/([^#/\s]+)(?:\/(pull|issues?)\/|#)(\d+)$/,
  )
  if (!match) return null

  return {
    owner: match[1] ?? '',
    repo: match[2] ?? '',
    kind: match[3]?.startsWith('pull') ? 'pull' : 'issue',
    number: Number(match[4]),
  }
}

function parseSlackRef(binding: SourceBindingRow) {
  const parts = binding.externalId.split(':').map((part) => part.trim())
  const [channelId, threadTs] = parts
  return {
    channelId: channelId || null,
    threadTs: threadTs || null,
  }
}

function schemaPropertyNames(inputSchema: unknown) {
  const root = objectOrNull(inputSchema)
  const properties = objectOrNull(root?.properties)
  return properties ? Object.keys(properties) : []
}

function candidateArgs(binding: SourceBindingRow, toolName: string) {
  const github = parseGithubRef(binding)
  const slack = parseSlackRef(binding)
  const targetUrl = binding.externalUrl || binding.externalId
  const isUrl = targetUrl.startsWith('http://') || targetUrl.startsWith('https://')
  const candidates: Record<string, unknown> = {
    id: binding.externalId,
    external_id: binding.externalId,
    externalId: binding.externalId,
    url: targetUrl,
    external_url: binding.externalUrl,
    externalUrl: binding.externalUrl,
    query: binding.externalId,
    urls: isUrl ? [targetUrl] : [],
    thread_id: binding.externalId,
    threadId: binding.externalId,
    file_id: binding.externalId,
    fileId: binding.externalId,
    channel_id: slack.channelId,
    channelId: slack.channelId,
    channel: slack.channelId,
    thread_ts: slack.threadTs ?? binding.externalId,
    threadTs: slack.threadTs ?? binding.externalId,
    ts: slack.threadTs ?? binding.externalId,
  }

  if (github) {
    candidates.owner = github.owner
    candidates.repo = github.repo
    candidates.repository = github.repo
    candidates.number = github.number
    candidates.issue_number = github.number
    candidates.issueNumber = github.number
    candidates.pull_number = github.number
    candidates.pullNumber = github.number
    candidates.pull_request_number = github.number
  }

  if (toolName === 'web_fetch_exa' && isUrl) {
    candidates.url = targetUrl
    candidates.urls = [targetUrl]
  }

  return candidates
}

function defaultArgsForTool(binding: SourceBindingRow, toolName: string) {
  const candidates = candidateArgs(binding, toolName)
  if (toolName === 'web_fetch_exa') {
    return Array.isArray(candidates.urls) && candidates.urls.length > 0
      ? { urls: candidates.urls }
      : { urls: [binding.externalId] }
  }
  if (toolName === 'pull_request_read' || toolName === 'issue_read') {
    return {
      owner: candidates.owner,
      repo: candidates.repo,
      number: candidates.number,
    }
  }
  if (toolName === 'slack_read_thread') {
    return {
      channel_id: candidates.channel_id,
      thread_ts: candidates.thread_ts,
    }
  }
  if (toolName === 'get_thread') {
    return { thread_id: binding.externalId }
  }
  if (toolName === 'read_file_content') {
    return { file_id: binding.externalId }
  }
  return { id: binding.externalId }
}

function argsForTool(
  binding: SourceBindingRow,
  tool: IssueRunMcpToolRecord,
): Record<string, unknown> {
  const properties = schemaPropertyNames(tool.inputSchema)
  if (properties.length === 0) return defaultArgsForTool(binding, tool.name)

  const candidates = candidateArgs(binding, tool.name)
  return Object.fromEntries(
    properties.flatMap((property) => {
      const value = candidates[property]
      if (value === null || value === undefined) return []
      if (Array.isArray(value) && value.length === 0) return []
      return [[property, value]]
    }),
  )
}

function sourceToolError(args: {
  code: IssueRunToolError['code']
  message: string
  cause?: unknown
}) {
  return new IssueRunToolError({
    code: args.code,
    message: args.message,
    cause: args.cause,
  })
}

async function loadSourceBindings(args: {
  context: IssueRunToolContext
  issueId: string
  bindingId?: string
}): Promise<ResultValue<SourceBindingRow[], IssueRunToolError>> {
  const db = getIssueRunDb(args.context.env.DATABASE_URL)
  const result = await Result.tryPromise({
    try: async () =>
      await db
        .select()
        .from(schema.issueSourceBinding)
        .where(
          args.bindingId
            ? and(
                eq(schema.issueSourceBinding.issueId, args.issueId),
                eq(schema.issueSourceBinding.id, args.bindingId),
              )
            : eq(schema.issueSourceBinding.issueId, args.issueId),
        )
        .orderBy(desc(schema.issueSourceBinding.updatedAt)),
    catch: (cause) => dbError('load issue source bindings', cause),
  })
  if (result.isErr()) return Result.err(result.error)
  return Result.ok(result.value)
}

async function readBindingSource(args: {
  binding: SourceBindingRow
  context: IssueRunToolContext
}): Promise<ResultValue<ReadSourceResult, IssueRunToolError>> {
  const bridge = args.context.mcp
  if (!bridge) {
    return Result.err(
      sourceToolError({
        code: 'not_configured',
        message: 'MCP connector bridge is not configured for read_source.',
      }),
    )
  }

  const connectorId = normalizeMcpConnectorId(args.binding.connectorId)
  const connector = getConnectorById(connectorId)
  if (!connector) {
    return Result.err(
      sourceToolError({
        code: 'not_configured',
        message: `Unknown connector: ${args.binding.connectorId}`,
      }),
    )
  }

  const toolName = readToolForBinding(args.binding)
  if (!toolName) {
    return Result.err(
      sourceToolError({
        code: 'invalid_input',
        message: `read_source is not wired for ${args.binding.connectorId}.${args.binding.sourceKind}.`,
      }),
    )
  }

  const classification = connector.tools[toolName]
  if (classification?.riskClass !== 'read') {
    return Result.err(
      sourceToolError({
        code: 'invalid_state',
        message: `${connectorId}.${toolName} is not classified as a read tool.`,
      }),
    )
  }

  const toolRecord = bridge
    .listTools({ serverId: connectorId })
    .find((candidate) => candidate.name === toolName)
  if (!toolRecord) {
    return Result.err(
      sourceToolError({
        code: 'not_found',
        message: `MCP tool ${connectorId}.${toolName} is not available.`,
      }),
    )
  }

  const callResult = await Result.tryPromise({
    try: async () =>
      await bridge.callTool({
        serverId: connectorId,
        name: toolName,
        arguments: argsForTool(args.binding, toolRecord),
      }),
    catch: (cause) =>
      connectorToolError(
        classifyConnectorError(cause),
        `Failed to read source through ${connectorId}.${toolName}.`,
      ),
  })
  if (callResult.isErr()) return Result.err(callResult.error)

  const resultObject = objectOrNull(callResult.value)
  if (resultObject?.isError === true) {
    return Result.err(
      connectorToolError(
        classifyConnectorError(callResult.value),
        `Failed to read source through ${connectorId}.${toolName}.`,
      ),
    )
  }

  return Result.ok({
    binding_id: args.binding.id,
    connector_id: args.binding.connectorId,
    mcp_connector_id: connectorId,
    source_kind: args.binding.sourceKind,
    external_id: args.binding.externalId,
    external_url: args.binding.externalUrl ?? null,
    tool: toolName,
    content: textFromMcpResult(callResult.value),
    payload: callResult.value,
  })
}

export function createReadSourceTool(context: IssueRunToolContext) {
  return tool({
    description:
      'Read the content for this issue source binding through the connector MCP. No approval is needed because this tool only reads.',
    inputSchema: readSourceInputSchema,
    execute: async (input) => {
      const runResult = requireRunState(context)
      if (runResult.isErr()) return toolErrorResult(runResult.error)
      const run = runResult.value

      const bridge = context.mcp
      if (!bridge) {
        return toolErrorResult(
          sourceToolError({
            code: 'not_configured',
            message: 'MCP connector bridge is not configured for read_source.',
          }),
        )
      }

      const readyResult = await bridge.ensureConnections()
      if (readyResult.isErr()) return toolErrorResult(readyResult.error)

      const bindingsResult = await loadSourceBindings({
        context,
        issueId: run.issueId,
        bindingId: input.binding_id,
      })
      if (bindingsResult.isErr()) return toolErrorResult(bindingsResult.error)
      if (bindingsResult.value.length === 0) {
        return toolErrorResult(
          sourceToolError({
            code: 'not_found',
            message: input.binding_id
              ? 'Source binding not found for this issue.'
              : 'This issue has no source bindings.',
          }),
        )
      }

      const sourceResults = await Promise.all(
        bindingsResult.value.map((binding) =>
          readBindingSource({ binding, context }),
        ),
      )
      const sources: ReadSourceResult[] = []
      for (const sourceResult of sourceResults) {
        if (sourceResult.isErr()) return toolErrorResult(sourceResult.error)
        sources.push(sourceResult.value)
      }

      const db = getIssueRunDb(context.env.DATABASE_URL)
      const eventResult = await appendIssueRunEvent({
        db,
        run,
        eventType: 'issue_run:message',
        stream: 'connector',
        message: 'Read source content',
        payload: {
          tool: 'read_source',
          ok: true,
          source_count: sources.length,
          bindings: sources.map((source) => ({
            binding_id: source.binding_id,
            connector_id: source.connector_id,
            source_kind: source.source_kind,
            tool: source.tool,
            has_text_content: Boolean(source.content),
          })),
        },
      })
      if (eventResult.isErr()) return toolErrorResult(eventResult.error)

      return toolOkResult({
        source_count: sources.length,
        sources,
      })
    },
  })
}
