import { Buffer } from 'node:buffer'
import { Result, TaggedError } from 'better-result'
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { GardenDatabase } from '@garden/db'
import * as schema from '@garden/db/schema'

export const browserChatPrincipalSchema = z.strictObject({
  sessionId: z.string().uuid(),
  userId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  agentId: z.string().uuid(),
  threadId: z.string().uuid(),
  runtimeKey: z.string().uuid(),
  runtimeName: z.string().min(1).max(256),
})
export type BrowserChatPrincipal = z.infer<typeof browserChatPrincipalSchema>
export const browserConnectionTag = 'garden.browser.bound.v1'
export const nonChatConnectionTag = 'garden.browser.nonchat.v1'
const chatConnectionTag = 'garden.browser.chat.v1'
const chunkPrefix = 'garden.browser.scope.v1.'

export class BrowserChatAuthorityError extends TaggedError(
  'BrowserChatAuthorityError',
)<{
  code: 'refused' | 'unavailable'
  message: string
  status: 401 | 403 | 503
}>() {}

export function browserChatRefused(status: 401 | 403 = 403) {
  return new BrowserChatAuthorityError({
    code: 'refused',
    message: 'Private chat access is unavailable. Reconnect to refresh access.',
    status,
  })
}

export function browserChatUnavailable() {
  return new BrowserChatAuthorityError({
    code: 'unavailable',
    message: 'Private chat access could not be verified. Try again shortly.',
    status: 503,
  })
}

/** Resolves scope from server-authenticated identity, never from frame fields. */
export async function resolveBrowserChatPrincipal(
  db: GardenDatabase,
  input: {
    sessionId: string
    userId: string
    runtimeName: string
    threadName: string
  },
): Promise<Result<BrowserChatPrincipal, BrowserChatAuthorityError>> {
  const valid = z
    .object({
      sessionId: z.string().uuid(),
      userId: z.string().uuid(),
      runtimeName: z.string().min(1).max(256),
      threadName: z.string().uuid(),
    })
    .safeParse(input)
  if (!valid.success) return Result.err(browserChatRefused())
  const rows = await Result.tryPromise({
    try: () =>
      db
        .select({
          sessionId: schema.session.id,
          userId: schema.session.userId,
          workspaceId: schema.chatThread.workspaceId,
          agentId: schema.chatThread.agentId,
          threadId: schema.chatThread.id,
          runtimeKey: schema.chatThread.runtimeKey,
        })
        .from(schema.session)
        .innerJoin(
          schema.member,
          eq(schema.member.userId, schema.session.userId),
        )
        .innerJoin(
          schema.chatThread,
          and(
            eq(schema.chatThread.workspaceId, schema.member.organizationId),
            eq(schema.chatThread.ownerUserId, schema.session.userId),
          ),
        )
        .innerJoin(schema.agent, eq(schema.agent.id, schema.chatThread.agentId))
        .where(
          and(
            eq(schema.session.id, input.sessionId),
            eq(schema.session.userId, input.userId),
            gt(schema.session.expiresAt, sql`clock_timestamp()`),
            eq(schema.agent.workspaceId, schema.chatThread.workspaceId),
            eq(schema.agent.status, 'active'),
            or(
              eq(schema.agent.hostName, input.runtimeName),
              sql`${schema.agent.id}::text = ${input.runtimeName}`,
            ),
            eq(schema.chatThread.runtimeKind, 'chat'),
            isNull(schema.chatThread.archivedAt),
            or(
              eq(schema.chatThread.id, input.threadName),
              eq(schema.chatThread.runtimeKey, input.threadName),
            ),
          ),
        )
        .limit(2),
    catch: () => browserChatUnavailable(),
  })
  return rows.andThen((values) => {
    if (values.length !== 1) return Result.err(browserChatRefused())
    const principal = browserChatPrincipalSchema.safeParse({
      ...values[0],
      runtimeName: input.runtimeName,
    })
    return principal.success
      ? Result.ok(principal.data)
      : Result.err(browserChatRefused())
  })
}

/** Every call reads current database authority and checks the original scope. */
export async function checkBrowserChatPrincipal(
  db: GardenDatabase,
  input: BrowserChatPrincipal,
): Promise<Result<BrowserChatPrincipal, BrowserChatAuthorityError>> {
  const parsed = browserChatPrincipalSchema.safeParse(input)
  if (!parsed.success) return Result.err(browserChatRefused())
  const current = await resolveBrowserChatPrincipal(db, {
    ...parsed.data,
    threadName: parsed.data.runtimeKey,
  })
  return current.andThen((principal) =>
    JSON.stringify(principal) === JSON.stringify(parsed.data)
      ? Result.ok(principal)
      : Result.err(browserChatRefused()),
  )
}

/** Platform tags survive hibernation without exposing cookies or session tokens. */
export function browserChatTags(principal: BrowserChatPrincipal): string[] {
  const encoded = Buffer.from(
    JSON.stringify(browserChatPrincipalSchema.parse(principal)),
  ).toString('base64url')
  const chunks = Math.ceil(encoded.length / 192)
  if (chunks > 6) throw new Error('Private chat scope exceeds tag capacity')
  return [
    browserConnectionTag,
    chatConnectionTag,
    ...Array.from(
      { length: chunks },
      (_, index) =>
        `${chunkPrefix}${index}:${encoded.slice(index * 192, (index + 1) * 192)}`,
    ),
  ]
}

/** A missing, duplicated or incomplete binding never becomes browser authority. */
export function browserChatPrincipalFromTags(
  tags: readonly string[],
): Result<BrowserChatPrincipal, BrowserChatAuthorityError> {
  if (
    tags.filter((tag) => tag === browserConnectionTag).length !== 1 ||
    tags.filter((tag) => tag === chatConnectionTag).length !== 1 ||
    tags.includes(nonChatConnectionTag)
  )
    return Result.err(browserChatRefused())
  const chunks = tags.filter((tag) => tag.startsWith(chunkPrefix))
  if (chunks.length < 2 || chunks.length > 6)
    return Result.err(browserChatRefused())
  const parts: string[] = []
  for (let index = 0; index < chunks.length; index++) {
    const matching = chunks.filter((tag) =>
      tag.startsWith(`${chunkPrefix}${index}:`),
    )
    if (matching.length !== 1) return Result.err(browserChatRefused())
    const value = matching[0]?.slice(`${chunkPrefix}${index}:`.length)
    if (!value || !/^[A-Za-z0-9_-]{1,192}$/.test(value))
      return Result.err(browserChatRefused())
    parts.push(value)
  }
  return Result.try({
    try: () =>
      JSON.parse(
        Buffer.from(parts.join(''), 'base64url').toString('utf8'),
      ) as unknown,
    catch: () => browserChatRefused(),
  }).andThen((value) => {
    const parsed = browserChatPrincipalSchema.safeParse(value)
    return parsed.success
      ? Result.ok(parsed.data)
      : Result.err(browserChatRefused())
  })
}
