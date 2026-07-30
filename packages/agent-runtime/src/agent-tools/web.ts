import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import { tool } from 'ai'
import { z } from 'zod'

/**
 * Direct Exa web search/fetch tools.
 *
 * Before this module, Exa was modelled as an MCP connector
 * (`packages/connectors/src/exa-search/connector.ts`) whose every call went
 * agent -> `McpProxySession` DO -> MCP `Client` -> streamable-HTTP -> Exa. That
 * bought a DO cold start, a persisted `upstream_session_id` that was replayed
 * after upstream expiry (and never cleared on the tool-call failure path, so a
 * dead session stuck), per-turn tool discovery, and a capability/permission
 * lookup — all for a read-only API with no per-user auth and no scopes. Search
 * was failing in staging as a result.
 *
 * Afterward Exa is a first-party tool hitting `api.exa.ai` over plain fetch with
 * a workspace-level API key, matching the shape of the other tools in this
 * directory (AI SDK `tool()` + zod + `better-result`). Modelled on the
 * equivalent surface in the mind-map repo (`apps/website/src/agent/tools/web.ts`),
 * including its retrieval-stash approach to context control.
 */

const EXA_BASE = 'https://api.exa.ai'

/**
 * Each query in a call is a separately billed Exa search. The cap exists to stop
 * the model fanning out a dozen speculative rephrasings on one turn; the error
 * message tells it to pick its best angles rather than silently truncating.
 */
const MAX_SEARCH_QUERIES_PER_CALL = 4

/**
 * Exa can return whole page bodies. Inlining those into the transcript burns the
 * context window on a 262k model that already carries a large tool surface, so a
 * single-page fetch is capped and the full body stays retrievable by handle.
 */
const MAX_INLINE_CONTENT_CHARS = 30_000

/** Search snippets are for triage, not reading; full text comes from the stash. */
const MAX_SNIPPET_CHARS = 240

/** Upper bound on per-result text pulled back when `includeContent` is false. */
const MAX_RESULT_TEXT_CHARS = 3_000

/**
 * Stashed retrievals are a within-conversation scratch space, not durable state.
 * An hour comfortably outlives the turn that produced them while keeping the DO's
 * SQLite storage from growing without bound.
 */
const RETRIEVAL_TTL_MS = 60 * 60 * 1000

/** Exa is a network dependency on the turn's critical path; don't hang a turn on it. */
const REQUEST_TIMEOUT_MS = 60_000

class ExaHttpError extends TaggedError('ExaHttpError')<{
  status: number
  body: string
}>() {}
class ExaTimeoutError extends TaggedError('ExaTimeoutError')<{
  url: string
}>() {}
class ExaParseError extends TaggedError('ExaParseError')<{
  body: string
  issue: string
}>() {}
class ExaNotConfiguredError extends TaggedError('ExaNotConfiguredError')<{
  message: string
}>() {}

type ExaError =
  | ExaHttpError
  | ExaTimeoutError
  | ExaParseError
  | ExaNotConfiguredError

export type WebToolsSqlValue = string | number | null
export type WebToolsSqlExec = (
  query: string,
  ...params: WebToolsSqlValue[]
) => Iterable<Record<string, unknown>>

const exaSearchResultSchema = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
  publishedDate: z.string().optional(),
  author: z.string().optional(),
  text: z.string().optional(),
  highlights: z.array(z.string()).optional(),
})

const exaSearchResponseSchema = z.object({
  results: z.array(exaSearchResultSchema).optional(),
})

const exaContentsResponseSchema = z.object({
  results: z
    .array(
      z.object({
        url: z.string().optional(),
        title: z.string().optional(),
        text: z.string().optional(),
        markdown: z.string().optional(),
        summary: z.string().optional(),
        highlights: z.array(z.string()).optional(),
      }),
    )
    .optional(),
})

const storedPageSchema = z.object({
  url: z.string(),
  title: z.string(),
  content: z.string(),
})

const queryHitsSchema = z.object({
  query: z.string(),
  answer: z.string(),
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      snippet: z.string(),
      publishedDate: z.string().optional(),
    }),
  ),
  fullContent: z.array(storedPageSchema),
  error: z.record(z.string(), z.unknown()).optional(),
})

const storedSearchPayloadSchema = z.object({
  queries: z.array(queryHitsSchema),
})
const storedFetchPayloadSchema = z.object({
  urls: z.array(storedPageSchema),
})

type QueryHits = z.infer<typeof queryHitsSchema>
type StoredSearchPayload = z.infer<typeof storedSearchPayloadSchema>
type StoredFetchPayload = z.infer<typeof storedFetchPayloadSchema>
type StoredRetrieval =
  | { type: 'search'; payload: StoredSearchPayload }
  | { type: 'fetch'; payload: StoredFetchPayload }

/**
 * Surfaces the failure to the model as data it can act on rather than throwing.
 * A thrown tool error aborts the step; a returned one lets the model retry with
 * a different query, fall back to another source, or tell the user what broke.
 */
function exaErrorPayload(error: ExaError) {
  if (error instanceof ExaHttpError) {
    return { error: error._tag, status: error.status, body: error.body }
  }
  if (error instanceof ExaTimeoutError) {
    return { error: error._tag, url: error.url }
  }
  if (error instanceof ExaNotConfiguredError) {
    return { error: error._tag, message: error.message }
  }
  return { error: error._tag, body: error.body, issue: error.issue }
}

function parseJsonWithSchema<T>(
  text: string,
  schema: z.ZodType<T>,
): ResultValue<T, ExaParseError> {
  const json = Result.try({
    try: () => JSON.parse(text) as unknown,
    catch: (cause) =>
      new ExaParseError({
        body: text.slice(0, 500),
        issue: cause instanceof Error ? cause.message : String(cause),
      }),
  })
  if (json.isErr()) return Result.err(json.error)

  const parsed = schema.safeParse(json.value)
  return parsed.success
    ? Result.ok(parsed.data)
    : Result.err(
        new ExaParseError({
          body: text.slice(0, 500),
          issue: parsed.error.message,
        }),
      )
}

/**
 * Composes the caller's abort signal with a request deadline so a cancelled turn
 * and a hung upstream both unblock the same way.
 */
function requestSignal(signal: AbortSignal | undefined) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function recencyToStartDate(filter: 'day' | 'week' | 'month' | 'year') {
  const days = { day: 1, week: 7, month: 30, year: 365 }[filter]
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

function createExaClient(apiKey: string | undefined) {
  return async function post<T>(
    path: string,
    body: Record<string, unknown>,
    schema: z.ZodType<T>,
    signal: AbortSignal | undefined,
  ): Promise<ResultValue<T, ExaError>> {
    if (!apiKey) {
      return Result.err(
        new ExaNotConfiguredError({
          message:
            'Web search is not configured for this workspace (missing EXA_API_KEY).',
        }),
      )
    }

    const url = `${EXA_BASE}${path}`
    const response = await Result.tryPromise({
      try: async () =>
        await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
          },
          body: JSON.stringify(body),
          signal: requestSignal(signal),
        }),
      catch: (cause): ExaError =>
        cause instanceof DOMException && cause.name === 'TimeoutError'
          ? new ExaTimeoutError({ url })
          : new ExaParseError({
              body: '',
              issue: cause instanceof Error ? cause.message : String(cause),
            }),
    })
    if (response.isErr()) return Result.err(response.error)

    const text = await Result.tryPromise({
      try: async () => await response.value.text(),
      catch: (cause): ExaError =>
        new ExaParseError({
          body: '',
          issue: cause instanceof Error ? cause.message : String(cause),
        }),
    })
    if (text.isErr()) return Result.err(text.error)

    if (!response.value.ok) {
      return Result.err(
        new ExaHttpError({
          status: response.value.status,
          body: text.value.slice(0, 500),
        }),
      )
    }

    return parseJsonWithSchema(text.value, schema)
  }
}

function normalizeHighlights(value: string[] | undefined) {
  return value?.filter((item) => item.trim().length > 0) ?? []
}

/**
 * Flattens Exa's per-result highlights into a single cited block. The model gets
 * source-attributed prose it can quote directly instead of having to stitch
 * highlight arrays back together itself.
 */
function buildAnswerFromResults(
  results: z.infer<typeof exaSearchResultSchema>[] | undefined,
) {
  if (!results?.length) return ''

  const parts: string[] = []
  for (const [index, item] of results.entries()) {
    if (!item.url) continue
    const highlights = normalizeHighlights(item.highlights)
    const content =
      highlights.length > 0
        ? highlights.join(' ')
        : (item.text?.trim().slice(0, 1000) ?? '')
    if (!content) continue
    parts.push(
      `${content}\nSource: ${item.title || `Source ${index + 1}`} (${item.url})`,
    )
  }

  return parts.join('\n\n')
}

function ensureRetrievalsTable(sql: WebToolsSqlExec) {
  sql(`
    CREATE TABLE IF NOT EXISTS web_retrievals (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      ts INTEGER NOT NULL,
      payload TEXT NOT NULL
    )
  `)
  sql(`DELETE FROM web_retrievals WHERE ts < ?`, Date.now() - RETRIEVAL_TTL_MS)
}

function storeRetrieval(
  sql: WebToolsSqlExec,
  type: StoredRetrieval['type'],
  payload: StoredSearchPayload | StoredFetchPayload,
) {
  return Result.try({
    try: () => {
      ensureRetrievalsTable(sql)
      const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
      sql(
        `INSERT INTO web_retrievals (id, type, ts, payload) VALUES (?, ?, ?, ?)`,
        id,
        type,
        Date.now(),
        JSON.stringify(payload),
      )
      return id
    },
    catch: (cause) =>
      cause instanceof Error ? cause : new Error(String(cause)),
  })
}

function loadRetrieval(
  sql: WebToolsSqlExec,
  id: string,
): StoredRetrieval | null {
  const rows = Result.try({
    try: () => {
      ensureRetrievalsTable(sql)
      return Array.from(
        sql(`SELECT type, payload FROM web_retrievals WHERE id = ?`, id),
      )
    },
    catch: (cause) =>
      cause instanceof Error ? cause : new Error(String(cause)),
  })
  if (rows.isErr()) return null

  for (const row of rows.value) {
    const type = String(row.type ?? '')
    const payloadText = String(row.payload ?? 'null')
    if (type === 'search') {
      const payload = parseJsonWithSchema(payloadText, storedSearchPayloadSchema)
      return payload.isOk() ? { type, payload: payload.value } : null
    }
    if (type === 'fetch') {
      const payload = parseJsonWithSchema(payloadText, storedFetchPayloadSchema)
      return payload.isOk() ? { type, payload: payload.value } : null
    }
  }

  return null
}

export const webSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).optional().describe('Single search query.'),
    queries: z
      .array(z.string().trim().min(1))
      .max(MAX_SEARCH_QUERIES_PER_CALL)
      .optional()
      .describe(
        `Several angles on one question, searched in parallel. Max ${MAX_SEARCH_QUERIES_PER_CALL}; each is a separate billed search.`,
      ),
    numResults: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe('Results per query (default 5, max 10).'),
    recency: z
      .enum(['day', 'week', 'month', 'year'])
      .optional()
      .describe('Only return pages published within this window.'),
    includeContent: z
      .boolean()
      .optional()
      .describe(
        'Pull full page text for each result (heavy — prefer fetch_content on the few URLs worth reading). Default false.',
      ),
  })
  .strict()

export const fetchContentInputSchema = z
  .object({
    url: z.url().optional(),
    urls: z.array(z.url()).max(10).optional(),
    format: z.enum(['markdown', 'text', 'summary', 'highlights']).optional(),
  })
  .strict()

export const getSearchContentInputSchema = z
  .object({
    responseId: z
      .string()
      .min(1)
      .describe('Handle returned by a prior web_search or fetch_content call.'),
    queryIndex: z.number().int().min(0).optional(),
    query: z.string().optional(),
    urlIndex: z.number().int().min(0).optional(),
    url: z.string().optional(),
  })
  .strict()

/**
 * Builds the web research tool surface.
 *
 * `sql` is the owning Durable Object's SQLite exec, used only for the retrieval
 * stash — search bodies land there and reach the model by handle, so a broad
 * search does not evict the rest of the conversation from the context window.
 */
export function createWebTools(deps: {
  env: { EXA_API_KEY?: string }
  sql: WebToolsSqlExec
}) {
  const post = createExaClient(deps.env.EXA_API_KEY)

  async function runOneSearch(
    query: string,
    options: {
      numResults?: number
      recency?: 'day' | 'week' | 'month' | 'year'
      includeContent?: boolean
      signal: AbortSignal | undefined
    },
  ): Promise<QueryHits> {
    const body: Record<string, unknown> = {
      query,
      type: 'auto',
      numResults: options.numResults ?? 5,
      contents: {
        text: options.includeContent
          ? true
          : { maxCharacters: MAX_RESULT_TEXT_CHARS },
        highlights: true,
      },
      ...(options.recency
        ? { startPublishedDate: recencyToStartDate(options.recency) }
        : {}),
    }

    const response = await post(
      '/search',
      body,
      exaSearchResponseSchema,
      options.signal,
    )
    if (response.isErr()) {
      return {
        query,
        answer: '',
        results: [],
        fullContent: [],
        error: exaErrorPayload(response.error),
      }
    }

    const results = response.value.results ?? []
    return {
      query,
      answer: buildAnswerFromResults(results),
      results: results
        .filter((item) => Boolean(item.url))
        .map((item, index) => ({
          title: item.title || `Source ${index + 1}`,
          url: item.url as string,
          snippet: (
            normalizeHighlights(item.highlights).join(' ') ||
            item.text ||
            ''
          ).slice(0, MAX_SNIPPET_CHARS),
          ...(item.publishedDate ? { publishedDate: item.publishedDate } : {}),
        })),
      fullContent: results
        .filter((item) => Boolean(item.url) && Boolean(item.text))
        .map((item) => ({
          url: item.url as string,
          title: item.title ?? '',
          content: item.text as string,
        })),
    }
  }

  return {
    web_search: tool({
      description:
        'Search the live web. Returns cited, source-backed snippets per query; full page bodies are stashed and pulled on demand with get_search_content. Best for current events, facts, people, companies, and anything past the training cutoff. Describe the ideal page rather than listing keywords. Each query is a separate billed search, so use two to four sharp angles, then fetch_content on the few URLs worth reading in full.',
      inputSchema: webSearchInputSchema,
      execute: async (input, { abortSignal }) => {
        const queries = input.queries?.length
          ? input.queries
          : input.query
            ? [input.query]
            : []
        if (queries.length === 0) {
          return {
            ok: false,
            error: 'no_query',
            message: "Provide 'query' or 'queries[]'.",
          }
        }

        const hits = await Promise.all(
          queries.map((query) =>
            runOneSearch(query, {
              ...(input.numResults !== undefined
                ? { numResults: input.numResults }
                : {}),
              ...(input.recency ? { recency: input.recency } : {}),
              ...(input.includeContent !== undefined
                ? { includeContent: input.includeContent }
                : {}),
              signal: abortSignal,
            }),
          ),
        )

        // A whole-call failure (bad key, upstream down) shows up as every query
        // carrying the same error. Report it once as a failure instead of
        // handing back a list of empty successes the model has to interpret.
        const firstError = hits.find((hit) => hit.error)?.error
        if (firstError && hits.every((hit) => hit.error)) {
          return { ok: false, ...firstError }
        }

        const stashed = storeRetrieval(deps.sql, 'search', { queries: hits })

        return {
          ok: true,
          ...(stashed.isOk() ? { responseId: stashed.value } : {}),
          queries: hits.map((hit) => ({
            query: hit.query,
            answer: hit.answer,
            results: hit.results,
            fullContentCount: hit.fullContent.length,
            ...(hit.error ? { error: hit.error } : {}),
          })),
          ...(stashed.isOk()
            ? {
                hint: `Pull a full page body with get_search_content({responseId:"${stashed.value}", queryIndex, urlIndex}).`,
              }
            : {}),
        }
      },
    }),

    fetch_content: tool({
      description:
        'Fetch clean, readable content for one or more URLs. Multiple URLs are fetched in parallel within a single call. Use after web_search to read the pages worth reading, or when the user gives you a URL directly.',
      inputSchema: fetchContentInputSchema,
      execute: async (input, { abortSignal }) => {
        const urls = input.urls?.length ? input.urls : input.url ? [input.url] : []
        if (urls.length === 0) {
          return {
            ok: false,
            error: 'no_url',
            message: "Provide 'url' or 'urls[]'.",
          }
        }

        const format = input.format ?? 'markdown'
        const response = await post(
          '/contents',
          {
            urls,
            ...(format === 'summary'
              ? { summary: true }
              : format === 'highlights'
                ? { highlights: true }
                : { text: true }),
          },
          exaContentsResponseSchema,
          abortSignal,
        )
        if (response.isErr()) {
          return { ok: false, ...exaErrorPayload(response.error) }
        }

        const pages = (response.value.results ?? []).map((page) => ({
          url: page.url ?? '',
          title: page.title ?? '',
          content:
            page.markdown ??
            page.text ??
            page.summary ??
            normalizeHighlights(page.highlights).join('\n\n'),
        }))

        const stashed = storeRetrieval(deps.sql, 'fetch', { urls: pages })
        const responseId = stashed.isOk() ? stashed.value : null

        const singlePage = pages.length === 1 ? pages[0] : undefined
        if (singlePage) {
          const truncated = singlePage.content.length > MAX_INLINE_CONTENT_CHARS
          return {
            ok: true,
            ...(responseId ? { responseId } : {}),
            url: singlePage.url,
            title: singlePage.title,
            content: truncated
              ? singlePage.content.slice(0, MAX_INLINE_CONTENT_CHARS)
              : singlePage.content,
            truncated,
            fullLength: singlePage.content.length,
            ...(truncated && responseId
              ? {
                  hint: `Showing ${MAX_INLINE_CONTENT_CHARS} of ${singlePage.content.length} chars. Use get_search_content({responseId:"${responseId}", urlIndex:0}) for the rest.`,
                }
              : {}),
          }
        }

        return {
          ok: true,
          ...(responseId ? { responseId } : {}),
          urls: pages.map((page, index) => ({
            index,
            url: page.url,
            title: page.title,
            length: page.content.length,
          })),
          ...(responseId
            ? {
                hint: `${pages.length} URLs fetched. Use get_search_content({responseId:"${responseId}", urlIndex:N}) to read any of them.`,
              }
            : {}),
        }
      },
    }),

    get_search_content: tool({
      description:
        'Read a full page body stashed by an earlier web_search or fetch_content call, identified by its responseId. Use this instead of re-searching when you already have a handle.',
      inputSchema: getSearchContentInputSchema,
      execute: async (input) => {
        const stored = loadRetrieval(deps.sql, input.responseId)
        if (!stored) {
          return {
            ok: false,
            error: 'not_found',
            message: `No stored retrieval for ${input.responseId}. It may have expired; run the search again.`,
          }
        }

        if (stored.type === 'fetch') {
          const page =
            input.url !== undefined
              ? stored.payload.urls.find((item) => item.url === input.url)
              : input.urlIndex !== undefined
                ? stored.payload.urls[input.urlIndex]
                : undefined
          if (!page) {
            return {
              ok: false,
              error: 'no_url_selector',
              available: stored.payload.urls.map((item, index) => ({
                index,
                url: item.url,
              })),
            }
          }
          return { ok: true, ...page }
        }

        const hit =
          input.query !== undefined
            ? stored.payload.queries.find((item) => item.query === input.query)
            : input.queryIndex !== undefined
              ? stored.payload.queries[input.queryIndex]
              : undefined
        if (!hit) {
          return {
            ok: false,
            error: 'no_query_selector',
            available: stored.payload.queries.map((item, index) => ({
              index,
              query: item.query,
            })),
          }
        }

        if (input.url !== undefined || input.urlIndex !== undefined) {
          const page =
            input.url !== undefined
              ? hit.fullContent.find((item) => item.url === input.url)
              : hit.fullContent[input.urlIndex as number]
          if (!page) {
            return {
              ok: false,
              error: 'no_url_selector',
              available: hit.fullContent.map((item, index) => ({
                index,
                url: item.url,
              })),
            }
          }
          return { ok: true, ...page }
        }

        return {
          ok: true,
          query: hit.query,
          answer: hit.answer,
          results: hit.results,
          availableBodies: hit.fullContent.map((item, index) => ({
            index,
            url: item.url,
          })),
        }
      },
    }),
  }
}
