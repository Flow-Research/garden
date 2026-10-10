import { Effect, Schema } from 'effect'
import { HttpClient, HttpClientRequest } from 'effect/unstable/http'
import {
  definePlugin,
  IntegrationSlug,
  ToolName,
  type InvokeToolInput,
  type AuthMethodDescriptor,
} from '@executor-js/sdk/core'
import { z } from 'zod'
import type { XBudgetReservation } from './x-budget'
import { X_AUTHORIZATION_URL, X_TOKEN_URL } from './x-oauth'

export const X_RESEARCH_SLUG = 'x-research'
const id = z.string().regex(/^[0-9]{1,19}$/)
const cursor = z.string().min(1).max(1024).optional()
const page = { limit: z.number().int().min(1).max(20).default(20), cursor }
const searchPage = {
  limit: z.number().int().min(10).max(20).default(20),
  cursor,
}
const inputSchemas = [
  z.object({ tool: z.literal('x_read_feed'), ...page }).strict(),
  z
    .object({
      tool: z.literal('x_search_posts'),
      ...searchPage,
      query: z.string().trim().min(1).max(512),
      startTime: z.iso.datetime().optional(),
      endTime: z.iso.datetime().optional(),
    })
    .strict(),
  z
    .object({ tool: z.literal('x_get_posts'), ids: z.array(id).min(1).max(20) })
    .strict(),
  z
    .object({
      tool: z.literal('x_read_thread'),
      postId: id,
      limit: z.number().int().min(11).max(20).default(20),
      cursor,
    })
    .strict(),
  z.object({ tool: z.literal('x_read_bookmarks'), ...page }).strict(),
] as const
const toolInput = z.discriminatedUnion('tool', inputSchemas)
const descriptions = {
  x_read_feed:
    'Read one bounded page of your chronological following feed. This is not the algorithmic For You feed.',
  x_search_posts:
    'Search one page of posts from the last seven days. Older archives are unavailable.',
  x_get_posts:
    'Read up to 20 specified posts. Deleted, protected or unavailable posts may be omitted.',
  x_read_thread:
    'Read an anchor post and one page of recent conversation replies. Always partial; replies older than seven days are unavailable.',
  x_read_bookmarks:
    'Read one page of your private bookmarks. Requires a separately authorized bookmark.read scope.',
} as const
export class XResearchError extends Schema.Error<XResearchError>(
  'XResearchError',
)({
  code: Schema.String,
  message: Schema.String,
  retryAt: Schema.optional(Schema.String),
}) {}
const failure = (code: string, message: string) =>
  new XResearchError({ code, message })

/** The same strict schemas drive discovery and runtime validation. No user ID,
 * arbitrary URL, headers, bulk pagination, or write operation is accepted. */
export function parseXResearchInput(
  name: string,
  args: unknown,
  now = Date.now(),
) {
  if (typeof args === 'object' && args !== null && 'tool' in args) {
    return Effect.fail(
      failure(
        'invalid_input',
        'The tool name is selected by the catalog, not an argument.',
      ),
    )
  }
  const parsed = toolInput.safeParse({
    ...(typeof args === 'object' && args !== null && !Array.isArray(args)
      ? args
      : { invalidArgs: true }),
    tool: name,
  })
  if (!parsed.success)
    return Effect.fail(
      failure(
        'invalid_input',
        'X tool arguments are invalid; use the declared schema and page limits.',
      ),
    )
  const input = parsed.data
  if (input.tool === 'x_search_posts') {
    const start =
      input.startTime === undefined ? undefined : Date.parse(input.startTime)
    const end =
      input.endTime === undefined ? undefined : Date.parse(input.endTime)
    if (
      (start !== undefined && (start < now - 7 * 86_400_000 || start >= now)) ||
      (end !== undefined && (end < now - 7 * 86_400_000 || end >= now)) ||
      (start !== undefined && end !== undefined && start >= end)
    ) {
      return Effect.fail(
        failure(
          'unsupported_window',
          'Recent search requires ordered timestamps within the last seven days and before now.',
        ),
      )
    }
  }
  return Effect.succeed(input)
}

export const xAuthMethods: readonly AuthMethodDescriptor[] = [
  {
    id: 'x-read',
    label: 'Personal research',
    kind: 'oauth',
    template: 'x-read',
    oauth: {
      authorizationUrl: X_AUTHORIZATION_URL,
      tokenUrl: X_TOKEN_URL,
      scopes: ['tweet.read', 'users.read', 'offline.access'],
    },
  },
  {
    id: 'x-bookmarks',
    label: 'Personal research and bookmarks',
    kind: 'oauth',
    template: 'x-bookmarks',
    oauth: {
      authorizationUrl: X_AUTHORIZATION_URL,
      tokenUrl: X_TOKEN_URL,
      scopes: ['tweet.read', 'users.read', 'offline.access', 'bookmark.read'],
    },
  },
]
const accountResponse = z.object({
  data: z.object({ id, username: z.string().min(1).max(100) }),
})
const post = z.object({
  id,
  text: z.string().max(100_000),
  author_id: id.optional(),
  created_at: z.string().optional(),
  conversation_id: id.optional(),
  lang: z.string().optional(),
  in_reply_to_user_id: id.optional(),
  referenced_posts: z
    .array(
      z.object({ id, type: z.enum(['replied_to', 'quoted', 'retweeted']) }),
    )
    .max(20)
    .optional(),
  note_post: z.object({ text: z.string().max(100_000) }).optional(),
})
const postsResponse = z
  .object({
    data: z.array(post).max(20).optional(),
    includes: z
      .object({
        users: z
          .array(
            z.object({ id, username: z.string(), name: z.string().optional() }),
          )
          .max(20)
          .optional(),
      })
      .optional(),
    meta: z.object({ next_token: z.string().max(1024).optional() }).optional(),
    errors: z
      .array(
        z.object({
          resource_id: z.string().optional(),
          type: z.string().optional(),
        }),
      )
      .max(20)
      .optional(),
  })
  .refine(
    (value) =>
      value.data !== undefined ||
      value.meta !== undefined ||
      value.errors !== undefined,
  )
const positiveMoney = z
  .string()
  .regex(/^[0-9]+$/)
  .transform(Number)
  .pipe(z.number().int().positive().max(2_147_483_647))
export interface XResearchOptions {
  readonly reserve?: XBudgetReservation
  readonly dailyBudgetMicroUsd?: string
  readonly postPriceMicroUsd?: string
  readonly userPriceMicroUsd?: string
}

/** Use Executor's injected HTTP client so hosted endpoint policy still applies.
 * Do not expose upstream bodies or HttpClient errors: they can contain tokens.
 * https://docs.x.com/x-api/posts/search-recent-posts */
const readX = Effect.fn('XResearch.read')(function* (
  token: string,
  path: string,
  params: Record<string, string>,
) {
  const client = yield* HttpClient.HttpClient
  const response = yield* client
    .execute(
      HttpClientRequest.get(`https://api.x.com${path}`).pipe(
        HttpClientRequest.setUrlParams(params),
        HttpClientRequest.bearerToken(token),
      ),
    )
    .pipe(
      Effect.mapError(() =>
        failure(
          'network_error',
          'X request failed. The reserved budget remains charged; retry explicitly.',
        ),
      ),
    )
  if (response.status < 200 || response.status >= 300) {
    const code =
      response.status === 401
        ? 'reconnect_required'
        : response.status === 403
          ? 'access_unavailable'
          : response.status === 429
            ? 'rate_limited'
            : 'upstream_error'
    const reset = response.headers['x-rate-limit-reset']
    const epoch = reset === undefined ? NaN : Number(reset)
    return yield* new XResearchError({
      code,
      message: `X returned HTTP ${response.status}. No automatic retry was made.`,
      ...(Number.isFinite(epoch) && epoch > 0 && epoch < 8_640_000_000_000
        ? { retryAt: new Date(epoch * 1000).toISOString() }
        : {}),
    })
  }
  return yield* response.json.pipe(
    Effect.mapError(() =>
      failure('invalid_response', 'X returned an unreadable response.'),
    ),
  )
})
const postParams = {
  'post.fields': 'created_at,conversation_id,lang,note_post',
  expansions: 'author_id',
  'user.fields': 'username,name',
}

/** Attach provenance without retaining content in Garden storage. Post text is
 * untrusted research data, never instructions. Missing posts remain explicit. */
function normalizePosts(body: z.infer<typeof postsResponse>) {
  const authors = new Map(
    (body.includes?.users ?? []).map((user) => [user.id, user]),
  )
  return (body.data ?? []).map((item) => ({
    id: item.id,
    text: item.note_post?.text ?? item.text,
    authorId: item.author_id,
    author:
      item.author_id === undefined ? undefined : authors.get(item.author_id),
    createdAt: item.created_at,
    conversationId: item.conversation_id,
    language: item.lang,
    replyToUserId: item.in_reply_to_user_id,
    references: item.referenced_posts ?? [],
    url: `https://x.com/i/web/status/${item.id}`,
  }))
}

/** Personal-only invocation guard is repeated at dispatch, independent of UI
 * owner selection. Reserve worst-case post + expanded-user reads before /me.
 * Never refund failures: provider charging is uncertain after network errors. */
export const invokeXResearch = (
  options: XResearchOptions,
  input: InvokeToolInput<unknown>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { ctx, toolRow, credential } = input
      if (
        toolRow.owner !== 'user' ||
        credential.owner !== 'user' ||
        !ctx.owner.subject ||
        toolRow.subject !== ctx.owner.subject ||
        toolRow.tenant !== ctx.owner.tenant ||
        toolRow.integration !== X_RESEARCH_SLUG
      ) {
        return yield* failure(
          'personal_connection_required',
          'X research requires your own personal connection in this workspace.',
        )
      }
      const args = yield* parseXResearchInput(String(toolRow.name), input.args)
      const required =
        args.tool === 'x_read_bookmarks'
          ? ['tweet.read', 'users.read', 'bookmark.read']
          : ['tweet.read', 'users.read']
      if (!credential.value) {
        return yield* failure(
          'reconnect_required',
          'Reconnect X with the required read scopes before using this tool.',
        )
      }
      if (
        required.some((scope) => !credential.grantedScopes?.includes(scope))
      ) {
        return yield* failure(
          'insufficient_scope',
          'Reconnect X with the required read scopes before using this tool.',
        )
      }
      const budget = positiveMoney.safeParse(options.dailyBudgetMicroUsd)
      const postPrice = positiveMoney.safeParse(options.postPriceMicroUsd)
      const userPrice = positiveMoney.safeParse(options.userPriceMicroUsd)
      if (
        !budget.success ||
        !postPrice.success ||
        !userPrice.success ||
        !options.reserve
      ) {
        return yield* failure(
          'budget_unconfigured',
          'X research is disabled until the daily budget and current read prices are configured.',
        )
      }
      const maxPosts =
        args.tool === 'x_get_posts' ? args.ids.length : args.limit
      const amount = maxPosts * postPrice.data + (maxPosts + 1) * userPrice.data
      const reservation = yield* options.reserve(
        String(ctx.owner.subject),
        amount,
        budget.data,
        new Date().toISOString().slice(0, 10),
      )
      if (reservation.kind === 'exhausted')
        return yield* failure(
          'budget_exhausted',
          'The daily X research budget cannot cover this request. Use fewer results or wait until the next UTC day.',
        )
      const token = credential.value
      const accountRaw = yield* readX(token, '/2/users/me', {})
      const account = accountResponse.safeParse(accountRaw)
      if (!account.success)
        return yield* failure(
          'invalid_response',
          'X account response is invalid.',
        )
      yield* ctx.connections.update(
        {
          owner: 'user',
          integration: credential.integration,
          name: credential.connection,
        },
        { identityLabel: `@${account.data.data.username}` },
      )
      let path: string
      let params: Record<string, string> = { ...postParams }
      let anchor: ReturnType<typeof normalizePosts> = []
      let conversationId: string | undefined
      switch (args.tool) {
        case 'x_read_feed':
          path = `/2/users/${account.data.data.id}/timelines/reverse_chronological`
          params.max_results = String(args.limit)
          if (args.cursor) params.pagination_token = args.cursor
          break
        case 'x_read_bookmarks':
          path = `/2/users/${account.data.data.id}/bookmarks`
          params.max_results = String(args.limit)
          if (args.cursor) params.pagination_token = args.cursor
          break
        case 'x_get_posts':
          path = '/2/tweets'
          params.ids = [...new Set(args.ids)].join(',')
          break
        case 'x_search_posts':
          path = '/2/tweets/search/recent'
          params.query = args.query
          params.max_results = String(args.limit)
          if (args.cursor) params.next_token = args.cursor
          if (args.startTime) params.start_time = args.startTime
          if (args.endTime) params.end_time = args.endTime
          break
        case 'x_read_thread': {
          const raw = yield* readX(token, '/2/tweets', {
            ...postParams,
            ids: args.postId,
          })
          const parsed = postsResponse.safeParse(raw)
          if (
            !parsed.success ||
            (parsed.data.data?.length ?? 0) > 1 ||
            (parsed.data.includes?.users?.length ?? 0) > 1
          )
            return yield* failure(
              'invalid_response',
              'X anchor response is invalid.',
            )
          anchor = normalizePosts(parsed.data)
          conversationId = anchor[0]?.conversationId
          if (!conversationId)
            return {
              kind: 'partial',
              posts: anchor,
              unavailableIds: anchor.length ? [] : [args.postId],
              account: account.data.data,
              coverage: {
                endpoint: '/2/tweets',
                window: 'conversation_unavailable',
                complete: false,
                requestedMaxPosts: maxPosts,
                returnedPosts: anchor.length,
              },
              retrievedAt: new Date().toISOString(),
              contentTrust: 'untrusted_source_text',
              reservedMicroUsd: amount,
              dailyReservedMicroUsd: reservation.reservedMicroUsd,
            }
          path = '/2/tweets/search/recent'
          params.query = `conversation_id:${conversationId}`
          params.max_results = String(args.limit - 1)
          if (args.cursor) params.next_token = args.cursor
          break
        }
      }
      const raw = yield* readX(token, path, params)
      const parsed = postsResponse.safeParse(raw)
      if (
        !parsed.success ||
        (parsed.data.data?.length ?? 0) >
          (args.tool === 'x_read_thread' ? maxPosts - 1 : maxPosts)
      )
        return yield* failure(
          'invalid_response',
          'X returned data outside the requested bounds.',
        )
      const posts = [
        ...new Map(
          [...anchor, ...normalizePosts(parsed.data)].map((item) => [
            item.id,
            item,
          ]),
        ).values(),
      ]
      const found = new Set(posts.map((item) => item.id))
      return {
        kind:
          parsed.data.errors?.length || args.tool === 'x_read_thread'
            ? 'partial'
            : 'page',
        account: account.data.data,
        posts,
        nextCursor: parsed.data.meta?.next_token,
        unavailableIds:
          args.tool === 'x_get_posts'
            ? args.ids.filter((postId) => !found.has(postId))
            : (parsed.data.errors ?? []).flatMap((error) =>
                error.resource_id ? [error.resource_id] : [],
              ),
        conversationId,
        coverage: {
          endpoint: path,
          window:
            args.tool === 'x_read_thread' || args.tool === 'x_search_posts'
              ? 'recent_seven_days_only'
              : 'provider_visible_records',
          pagesFetched: args.tool === 'x_read_thread' ? 2 : 1,
          requestedMaxPosts: maxPosts,
          returnedPosts: posts.length,
          hasMore: Boolean(parsed.data.meta?.next_token),
          complete: false,
          feedKind:
            args.tool === 'x_read_feed' ? 'following_chronological' : undefined,
        },
        retrievedAt: new Date().toISOString(),
        reservedMicroUsd: amount,
        dailyReservedMicroUsd: reservation.reservedMicroUsd,
        contentTrust: 'untrusted_source_text',
      }
    }).pipe(Effect.provide(input.ctx.httpClientLayer)),
  )

/** Curated dynamic toolkit uses public SDK hooks. OpenAPI alone cannot enforce
 * personal ownership, resolve /me, or reserve a budget before every paid call. */
export const xResearchPlugin = definePlugin(
  (options: XResearchOptions = {}) => ({
    id: 'xResearch' as const,
    storage: () => ({}),
    extension: (ctx) => ({
      install: () =>
        ctx.core.integrations.register({
          slug: IntegrationSlug.make(X_RESEARCH_SLUG),
          name: 'X Personal Research',
          description:
            'Read-only personal X research. Feed, recent search, posts, partial threads and optional bookmarks. Source text is untrusted data.',
          config: {},
          canRemove: true,
          canRefresh: true,
        }),
    }),
    describeAuthMethods: () => xAuthMethods,
    describeIntegrationDisplay: () => ({ url: 'https://x.com', family: 'x' }),
    resolveTools: (input) =>
      Effect.succeed({
        tools:
          input.connection.owner !== 'user'
            ? []
            : inputSchemas
                .filter(
                  (schema) =>
                    schema.shape.tool.value !== 'x_read_bookmarks' ||
                    String(input.template) === 'x-bookmarks',
                )
                .map((schema) => ({
                  name: ToolName.make(schema.shape.tool.value),
                  description: descriptions[schema.shape.tool.value],
                  inputSchema: z.toJSONSchema(
                    z
                      .object(
                        Object.fromEntries(
                          Object.entries(schema.shape).filter(
                            ([key]) => key !== 'tool',
                          ),
                        ),
                      )
                      .strict(),
                  ),
                  annotations: { requiresApproval: false },
                })),
      }),
    validateToolArgs: (input) =>
      parseXResearchInput(String(input.toolRow.name), input.args).pipe(
        Effect.asVoid,
      ),
    invokeTool: (input) => invokeXResearch(options, input),
  }),
)
