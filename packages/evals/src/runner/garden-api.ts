import { Result } from 'better-result'
import { z } from 'zod'
import { issueRunStatusSchema } from '../index.ts'
import { GardenEvalError } from './errors.ts'

const issueResponseSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  assignee_type: z.literal('agent'),
  assignee_id: z.string().uuid(),
})

const runStartResponseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('started'), runId: z.string().uuid() }),
  z.object({ kind: z.literal('resumed'), runId: z.string().uuid() }),
  z.object({ kind: z.literal('skipped'), reason: z.string().min(1) }),
])

const runUsageResponseSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cached_input_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
  model: z.string().min(1),
  model_provider: z.string().min(1),
  step_count: z.number().int().nonnegative(),
  recorded_at_ms: z.number().int().nonnegative(),
})

const runResponseSchema = z.object({
  run: z.object({
    id: z.string().uuid(),
    issue_id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    status: issueRunStatusSchema,
    usage: runUsageResponseSchema.nullable(),
    started_at: z.iso.datetime().nullable(),
    finished_at: z.iso.datetime().nullable(),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
  }),
  events: z.array(z.unknown()),
  work_products: z.array(z.unknown()),
})

const chatThreadResponseSchema = z.object({
  id: z.string().uuid(),
  hostName: z.string().min(1),
  runtime_key: z.string().min(1),
})

const chatDocumentUploadResponseSchema = z.object({
  ok: z.literal(true),
  document_id: z.string().uuid(),
  filename: z.string().min(1),
  version_number: z.number().int().positive(),
})

const decideAnalysisStatusSchema = z.enum([
  'queued',
  'running',
  'cancel_requested',
  'completed',
  'failed',
  'cancelled',
])

const decideAnalysesResponseSchema = z.object({
  runs: z.array(
    z.object({
      runId: z.string().uuid(),
      status: decideAnalysisStatusSchema,
      files: z.array(
        z.object({
          name: z.string().min(1),
          url: z.url(),
        }),
      ),
    }),
  ),
})

export type GardenDecideAnalysesResponse = z.infer<
  typeof decideAnalysesResponseSchema
>

type IssueResponse = z.infer<typeof issueResponseSchema>
export type GardenIssueRunStartResponse = z.infer<typeof runStartResponseSchema>
export type GardenIssueRunResponse = z.infer<typeof runResponseSchema>

type GardenApiConfig = {
  baseUrl: string
  sessionCookie: string
  fetch?: typeof fetch
}

const maxDecideWorkbookBytes = 100 * 1024 * 1024

type JsonRequest<TSchema extends z.ZodType> = {
  operation:
    | 'create_issue'
    | 'start_issue_run'
    | 'read_issue_run'
    | 'create_chat_thread'
    | 'upload_chat_document'
    | 'read_decide_analyses'
  stage: GardenEvalError['stage']
  invalidReason: GardenEvalError['invalidReason']
  issueId?: string
  threadId?: string
  runId?: string
  url: URL
  init: RequestInit
  deadlineAt: number
  schema: TSchema
}

/**
 * Parses Garden API replies before the runner uses them. Before evals, no
 * package checked that run IDs and statuses matched Garden's API contract.
 * References: `apps/web/src/routes/api/issues.ts`,
 * `apps/web/src/routes/api/issues/$id/runs.ts`, and
 * `apps/web/src/routes/api/runs/$id.ts`.
 */
async function requestJson<TSchema extends z.ZodType>(
  input: JsonRequest<TSchema>,
  fetcher: typeof fetch,
): Promise<Result<z.output<TSchema>, GardenEvalError>> {
  return Result.gen(async function* () {
    const remainingMs = input.deadlineAt - Date.now()
    if (remainingMs <= 0) {
      return Result.err(
        new GardenEvalError({
          stage: input.stage,
          code: 'deadline_reached',
          message: `The eval deadline expired before ${input.operation}.`,
          invalidReason: input.invalidReason,
          issueId: input.issueId,
          threadId: input.threadId,
          runId: input.runId,
        }),
      )
    }

    const response = yield* Result.await(
      Result.tryPromise({
        try: () =>
          fetcher(input.url, {
            ...input.init,
            redirect: 'error',
            signal: AbortSignal.timeout(remainingMs),
          }),
        catch: (cause) =>
          new GardenEvalError({
            stage: input.stage,
            code:
              cause instanceof Error && cause.name === 'TimeoutError'
                ? 'deadline_reached'
                : 'network_error',
            message: `Garden API request failed during ${input.operation}.`,
            invalidReason: input.invalidReason,
            issueId: input.issueId,
            threadId: input.threadId,
            runId: input.runId,
            cause,
          }),
      }),
    )

    if (!response.ok) {
      return Result.err(
        new GardenEvalError({
          stage: input.stage,
          code: 'http_error',
          message: `Garden API returned HTTP ${response.status} during ${input.operation}.`,
          invalidReason: input.invalidReason,
          issueId: input.issueId,
          threadId: input.threadId,
          runId: input.runId,
        }),
      )
    }

    const payload: unknown = yield* Result.await(
      Result.tryPromise({
        try: () => response.json(),
        catch: (cause) =>
          new GardenEvalError({
            stage: input.stage,
            code: 'invalid_json',
            message: `Garden API returned invalid JSON during ${input.operation}.`,
            invalidReason: input.invalidReason,
            issueId: input.issueId,
            threadId: input.threadId,
            runId: input.runId,
            cause,
          }),
      }),
    )
    const parsed = input.schema.safeParse(payload)
    if (!parsed.success) {
      return Result.err(
        new GardenEvalError({
          stage: input.stage,
          code: 'invalid_response',
          message: `Garden API returned an invalid response during ${input.operation}.`,
          invalidReason: input.invalidReason,
          issueId: input.issueId,
          threadId: input.threadId,
          runId: input.runId,
        }),
      )
    }

    return Result.ok(parsed.data)
  })
}

/**
 * Creates issues and reads issue runs through the same authenticated API as
 * Garden's UI. The prior eval design had no live runner. This client keeps the
 * session cookie at the request boundary and never returns it in evidence.
 */
export function createGardenApiClient(config: GardenApiConfig) {
  const baseUrl = new URL(config.baseUrl)
  const fetcher = config.fetch ?? fetch

  return {
    /**
     * Creates a non-starting issue so the runner can start its run once.
     * Before this method, evals had no public issue creation path. Reference:
     * `POST /api/issues` in `apps/web/src/routes/api/issues.ts`.
     */
    createIssue(input: {
      workspaceId: string
      agentId: string
      title: string
      description: string
      deadlineAt: number
    }): Promise<Result<IssueResponse, GardenEvalError>> {
      const url = new URL('/api/issues', baseUrl)
      url.searchParams.set('workspace_id', input.workspaceId)
      return requestJson(
        {
          operation: 'create_issue',
          stage: 'fixture_setup',
          invalidReason: 'fixture_setup_failed',
          url,
          deadlineAt: input.deadlineAt,
          schema: issueResponseSchema,
          init: {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              cookie: config.sessionCookie,
            },
            body: JSON.stringify({
              title: input.title,
              description: input.description,
              status: 'todo',
              assignee_type: 'agent',
              assignee_id: input.agentId,
              auto_start: false,
            }),
          },
        },
        fetcher,
      )
    },

    /**
     * Starts the normal Garden workflow for one new eval issue. Before this
     * method, evals could not exercise the product run path. Reference:
     * `POST /api/issues/$id/runs`.
     */
    startIssueRun(input: {
      issueId: string
      deadlineAt: number
    }): Promise<Result<GardenIssueRunStartResponse, GardenEvalError>> {
      return requestJson(
        {
          operation: 'start_issue_run',
          stage: 'garden_execution',
          invalidReason: 'garden_execution_failed',
          issueId: input.issueId,
          url: new URL(
            `/api/issues/${encodeURIComponent(input.issueId)}/runs`,
            baseUrl,
          ),
          deadlineAt: input.deadlineAt,
          schema: runStartResponseSchema,
          init: {
            method: 'POST',
            headers: { cookie: config.sessionCookie },
          },
        },
        fetcher,
      )
    },

    /**
     * Reads one run and validates its ID, issue, workspace, status, and usage.
     * Before this method, evals could not observe a stored terminal result.
     * Reference: `GET /api/runs/$id`.
     */
    getIssueRun(input: {
      issueId: string
      runId: string
      deadlineAt: number
    }): Promise<Result<GardenIssueRunResponse, GardenEvalError>> {
      return requestJson(
        {
          operation: 'read_issue_run',
          stage: 'evidence_collection',
          invalidReason: 'required_evidence_unavailable',
          issueId: input.issueId,
          runId: input.runId,
          url: new URL(`/api/runs/${encodeURIComponent(input.runId)}`, baseUrl),
          deadlineAt: input.deadlineAt,
          schema: runResponseSchema,
          init: { headers: { cookie: config.sessionCookie } },
        },
        fetcher,
      )
    },

    /**
     * Creates a fresh chat thread through Garden's user API. Before this
     * method, the eval package could only start issue runs. References:
     * `POST /api/chat/threads` and `toChatThread`.
     */
    createChatThread(input: {
      threadId: string
      agentId: string
      title: string
      deadlineAt: number
    }): Promise<Result<z.infer<typeof chatThreadResponseSchema>, GardenEvalError>> {
      return requestJson(
        {
          operation: 'create_chat_thread',
          stage: 'fixture_setup',
          invalidReason: 'fixture_setup_failed',
          threadId: input.threadId,
          url: new URL('/api/chat/threads', baseUrl),
          deadlineAt: input.deadlineAt,
          schema: chatThreadResponseSchema,
          init: {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              cookie: config.sessionCookie,
            },
            body: JSON.stringify({
              id: input.threadId,
              title: input.title,
              agent_id: input.agentId,
            }),
          },
        },
        fetcher,
      )
    },

    /**
     * Uploads the task fixture through the thread document API used by chat.
     * Before this method, chat evals could not exercise document routing.
     * Reference: `POST /api/chat/threads/$id/documents`.
     */
    uploadChatDocument(input: {
      threadId: string
      filename: string
      mediaType: string
      bytes: Uint8Array
      deadlineAt: number
    }): Promise<
      Result<z.infer<typeof chatDocumentUploadResponseSchema>, GardenEvalError>
    > {
      const form = new FormData()
      form.append(
        'file',
        new Blob([Uint8Array.from(input.bytes)], { type: input.mediaType }),
        input.filename,
      )
      return requestJson(
        {
          operation: 'upload_chat_document',
          stage: 'fixture_setup',
          invalidReason: 'fixture_setup_failed',
          threadId: input.threadId,
          url: new URL(
            `/api/chat/threads/${encodeURIComponent(input.threadId)}/documents`,
            baseUrl,
          ),
          deadlineAt: input.deadlineAt,
          schema: chatDocumentUploadResponseSchema,
          init: {
            method: 'POST',
            headers: { cookie: config.sessionCookie },
            body: form,
          },
        },
        fetcher,
      )
    },

    /**
     * Reads the Decide runs owned by one new thread. A fresh thread makes this
     * list a direct record of whether Garden selected the Decide tool.
     * Reference: `GET /api/chat/threads/$threadId/decide-analyses`.
     */
    listDecideAnalyses(input: {
      threadId: string
      deadlineAt: number
    }): Promise<
      Result<z.infer<typeof decideAnalysesResponseSchema>, GardenEvalError>
    > {
      return requestJson(
        {
          operation: 'read_decide_analyses',
          stage: 'evidence_collection',
          invalidReason: 'required_evidence_unavailable',
          threadId: input.threadId,
          url: new URL(
            `/api/chat/threads/${encodeURIComponent(input.threadId)}/decide-analyses`,
            baseUrl,
          ),
          deadlineAt: input.deadlineAt,
          schema: decideAnalysesResponseSchema,
          init: { headers: { cookie: config.sessionCookie } },
        },
        fetcher,
      )
    },

    /**
     * Downloads only workbook links from Decide's documented output host.
     * Before this method, the eval could check a file name but not open its
     * workbook. References: `decideGeneratedFiles` and its output URL fixtures.
     */
    downloadDecideWorkbook(input: {
      url: string
      deadlineAt: number
      runId: string
    }): Promise<Result<Uint8Array, GardenEvalError>> {
      return Result.gen(async function* () {
        const parsedUrl = z
          .url()
          .refine((value) => {
            const url = new URL(value)
            return (
              url.protocol === 'https:' &&
              url.hostname === 'api.trydecide.co' &&
              url.pathname.startsWith('/uploads/agent-sessions/') &&
              url.pathname.includes('/outputs/') &&
              url.pathname.toLowerCase().endsWith('.xlsx') &&
              !url.username &&
              !url.password
            )
          })
          .safeParse(input.url)
        if (!parsedUrl.success) {
          return Result.err(
            new GardenEvalError({
              stage: 'evidence_collection',
              code: 'unsupported_artifact_url',
              message: 'Decide returned a workbook URL outside its output host.',
              invalidReason: 'required_evidence_unavailable',
              runId: input.runId,
            }),
          )
        }

        const remainingMs = input.deadlineAt - Date.now()
        if (remainingMs <= 0) {
          return Result.err(
            new GardenEvalError({
              stage: 'evidence_collection',
              code: 'deadline_reached',
              message: 'The eval deadline expired before the workbook download.',
              invalidReason: 'required_evidence_unavailable',
              runId: input.runId,
            }),
          )
        }

        const response = yield* Result.await(
          Result.tryPromise({
            try: () =>
              fetcher(parsedUrl.data, {
                redirect: 'error',
                signal: AbortSignal.timeout(remainingMs),
              }),
            catch: (cause) =>
              new GardenEvalError({
                stage: 'evidence_collection',
                code: 'workbook_download_failed',
                message: 'The Decide workbook could not be downloaded.',
                invalidReason: 'required_evidence_unavailable',
                runId: input.runId,
                cause,
              }),
          }),
        )

        if (!response.ok) {
          return Result.err(
            new GardenEvalError({
              stage: 'evidence_collection',
              code: 'workbook_http_error',
              message: `Decide workbook returned HTTP ${response.status}.`,
              invalidReason: 'required_evidence_unavailable',
              runId: input.runId,
            }),
          )
        }

        const contentLength = Number(response.headers.get('content-length'))
        if (
          Number.isFinite(contentLength) &&
          contentLength > maxDecideWorkbookBytes
        ) {
          return Result.err(
            new GardenEvalError({
              stage: 'evidence_collection',
              code: 'workbook_too_large',
              message: 'The Decide workbook exceeds Garden’s 100 MB upload limit.',
              invalidReason: 'required_evidence_unavailable',
              runId: input.runId,
            }),
          )
        }

        const reader = response.body?.getReader()
        if (!reader) {
          return Result.err(
            new GardenEvalError({
              stage: 'evidence_collection',
              code: 'workbook_read_failed',
              message: 'The Decide workbook response has no readable body.',
              invalidReason: 'required_evidence_unavailable',
              runId: input.runId,
            }),
          )
        }

        const chunks: Uint8Array[] = []
        let totalBytes = 0
        while (true) {
          const chunk = yield* Result.await(
            Result.tryPromise({
              try: () => reader.read(),
              catch: (cause) =>
                new GardenEvalError({
                  stage: 'evidence_collection',
                  code: 'workbook_read_failed',
                  message: 'The Decide workbook response could not be read.',
                  invalidReason: 'required_evidence_unavailable',
                  runId: input.runId,
                  cause,
                }),
            }),
          )
          if (chunk.done) break
          totalBytes += chunk.value.byteLength
          if (totalBytes > maxDecideWorkbookBytes) {
            void reader.cancel().then(
              () => undefined,
              () => undefined,
            )
            return Result.err(
              new GardenEvalError({
                stage: 'evidence_collection',
                code: 'workbook_too_large',
                message: 'The Decide workbook exceeds Garden’s 100 MB upload limit.',
                invalidReason: 'required_evidence_unavailable',
                runId: input.runId,
              }),
            )
          }
          chunks.push(chunk.value)
        }

        const bytes = new Uint8Array(totalBytes)
        let offset = 0
        for (const chunk of chunks) {
          bytes.set(chunk, offset)
          offset += chunk.byteLength
        }
        return Result.ok(bytes)
      })
    },
  }
}
