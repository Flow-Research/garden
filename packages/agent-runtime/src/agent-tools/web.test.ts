import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWebTools, type WebToolsSqlExec } from './web'

/**
 * Minimal stand-in for the Durable Object's `storage.sql.exec`. The web tools
 * only need INSERT/SELECT against one table, so a Map keyed by retrieval id
 * exercises the real stash round-trip without a SQLite dependency.
 */
function createSqlStub(): WebToolsSqlExec {
  const rows = new Map<string, { type: string; ts: number; payload: string }>()

  return (query, ...params) => {
    const normalized = query.trim().toLowerCase()

    if (normalized.startsWith('insert into web_retrievals')) {
      const [id, type, ts, payload] = params
      rows.set(String(id), {
        type: String(type),
        ts: Number(ts),
        payload: String(payload),
      })
      return []
    }

    if (normalized.startsWith('select')) {
      const row = rows.get(String(params[0]))
      return row ? [{ type: row.type, payload: row.payload }] : []
    }

    return []
  }
}

function searchResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

const execute = async (
  tool: { execute?: (input: never, options: never) => unknown },
  input: unknown,
) =>
  (await tool.execute?.(
    input as never,
    {
      toolCallId: 'call-1',
      messages: [],
    } as never,
  )) as Record<string, unknown>

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createWebTools', () => {
  it('exposes exactly the three web tools', () => {
    const tools = createWebTools({ env: {}, sql: createSqlStub() })

    expect(Object.keys(tools).sort()).toEqual([
      'fetch_content',
      'get_search_content',
      'web_search',
    ])
  })

  it('reports an unconfigured key to the model instead of throwing', async () => {
    const tools = createWebTools({ env: {}, sql: createSqlStub() })

    const result = await execute(tools.web_search, { query: 'garden' })

    expect(result.ok).toBe(false)
    expect(result.error).toBe('ExaNotConfiguredError')
  })

  it('rejects a call with neither query nor queries', async () => {
    const tools = createWebTools({
      env: { EXA_API_KEY: 'test-key' },
      sql: createSqlStub(),
    })

    const result = await execute(tools.web_search, {})

    expect(result.ok).toBe(false)
    expect(result.error).toBe('no_query')
  })

  it('searches each query in parallel and authenticates with the API key', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(searchResponse({ results: [] }))
    const tools = createWebTools({
      env: { EXA_API_KEY: 'test-key' },
      sql: createSqlStub(),
    })

    await execute(tools.web_search, { queries: ['first', 'second'] })

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    const [url, init] = fetchSpy.mock.calls[0] ?? []
    expect(String(url)).toBe('https://api.exa.ai/search')
    expect(new Headers(init?.headers).get('x-api-key')).toBe('test-key')
  })

  it('keeps page bodies out of the result and returns them by handle', async () => {
    const body = 'x'.repeat(5_000)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      searchResponse({
        results: [
          {
            title: 'Garden',
            url: 'https://example.com/garden',
            text: body,
            highlights: ['a highlight'],
          },
        ],
      }),
    )
    const sql = createSqlStub()
    const tools = createWebTools({ env: { EXA_API_KEY: 'test-key' }, sql })

    const search = await execute(tools.web_search, { query: 'garden' })
    expect(search.ok).toBe(true)
    expect(JSON.stringify(search)).not.toContain(body)

    const queries = search.queries as Array<{
      availableBodies: Array<{ index: number; url: string }>
    }>
    expect(queries[0]?.availableBodies).toEqual([
      {
        index: 0,
        url: 'https://example.com/garden',
        title: 'Garden',
        length: 5_000,
      },
    ])

    const pulled = await execute(tools.get_search_content, {
      responseId: search.responseId,
      queryIndex: 0,
      urlIndex: 0,
    })

    expect(pulled.ok).toBe(true)
    expect(pulled.url).toBe('https://example.com/garden')
    expect(pulled.content).toBe(body)
  })

  it('surfaces an upstream HTTP failure as a tool-level error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('nope', { status: 401 }),
    )
    const tools = createWebTools({
      env: { EXA_API_KEY: 'bad-key' },
      sql: createSqlStub(),
    })

    const result = await execute(tools.web_search, { query: 'garden' })

    expect(result.ok).toBe(false)
    expect(result.error).toBe('ExaHttpError')
    expect(result.status).toBe(401)
  })

  it('truncates a single fetched page and points at the stashed remainder', async () => {
    const body = 'y'.repeat(40_000)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      searchResponse({
        results: [
          { url: 'https://example.com/long', title: 'Long', text: body },
        ],
      }),
    )
    const tools = createWebTools({
      env: { EXA_API_KEY: 'test-key' },
      sql: createSqlStub(),
    })

    const result = await execute(tools.fetch_content, {
      url: 'https://example.com/long',
    })

    expect(result.truncated).toBe(true)
    expect(result.fullLength).toBe(40_000)
    expect(String(result.content)).toHaveLength(30_000)

    const remainder = await execute(tools.get_search_content, {
      responseId: result.responseId,
      urlIndex: 0,
      offset: 30_000,
    })
    expect(remainder.ok).toBe(true)
    expect(remainder.offset).toBe(30_000)
    expect(String(remainder.content)).toHaveLength(10_000)
    expect(remainder.truncated).toBe(false)
  })

  it('reports HTTP-200 crawl failures instead of treating them as empty success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      searchResponse({
        results: [],
        statuses: [
          {
            id: 'https://example.com/private',
            status: 'error',
            error: { tag: 'SOURCE_NOT_AVAILABLE', httpStatusCode: 403 },
          },
        ],
      }),
    )
    const tools = createWebTools({
      env: { EXA_API_KEY: 'test-key' },
      sql: createSqlStub(),
    })

    const result = await execute(tools.fetch_content, {
      url: 'https://example.com/private',
    })

    expect(result).toEqual({
      ok: false,
      error: 'content_fetch_failed',
      failures: [
        {
          url: 'https://example.com/private',
          tag: 'SOURCE_NOT_AVAILABLE',
          httpStatusCode: 403,
        },
      ],
    })
  })

  it('keeps a multi-URL result shape when only one crawl succeeds', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      searchResponse({
        results: [
          {
            url: 'https://example.com/available',
            title: 'Available',
            text: 'content',
          },
        ],
        statuses: [
          { id: 'https://example.com/available', status: 'success' },
          {
            id: 'https://example.com/missing',
            status: 'error',
            error: { tag: 'CRAWL_NOT_FOUND', httpStatusCode: 404 },
          },
        ],
      }),
    )
    const tools = createWebTools({
      env: { EXA_API_KEY: 'test-key' },
      sql: createSqlStub(),
    })

    const result = await execute(tools.fetch_content, {
      urls: ['https://example.com/available', 'https://example.com/missing'],
    })

    expect(result.ok).toBe(true)
    expect(result).not.toHaveProperty('content')
    expect(result.urls).toEqual([
      {
        index: 0,
        url: 'https://example.com/available',
        title: 'Available',
        length: 7,
      },
    ])
    expect(result.failures).toEqual([
      {
        url: 'https://example.com/missing',
        tag: 'CRAWL_NOT_FOUND',
        httpStatusCode: 404,
      },
    ])
  })

  it('reports an expired handle rather than failing the turn', async () => {
    const tools = createWebTools({
      env: { EXA_API_KEY: 'test-key' },
      sql: createSqlStub(),
    })

    const result = await execute(tools.get_search_content, {
      responseId: 'gone',
    })

    expect(result.ok).toBe(false)
    expect(result.error).toBe('not_found')
  })
})
