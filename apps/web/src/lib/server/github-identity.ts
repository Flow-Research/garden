import { and, eq } from 'drizzle-orm'
import { Result, TaggedError } from 'better-result'
import { z } from 'zod'
import { schema, type Db } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import { linkOrRefreshMemberGithubIdentity } from '@/lib/server/workspace-members'

/**
 * Self-serve "Link with GitHub" (S2-09).
 *
 * Before: only workspace owners/admins could set a member's GitHub identity,
 * from a typed login, because Garden could not prove the account belonged to
 * the member (docs/reference/known-gaps.md). After: the member signs in through
 * the Garden GitHub App's user authorization, GitHub proves ownership, and
 * Garden writes the verified id + login to the member's own row. The user
 * access token is used once to read `/user` and then dropped; nothing stores it.
 *
 * Reference: GitHub docs "Generating a user access token for a GitHub App"
 * (web application flow: /login/oauth/authorize → /login/oauth/access_token).
 */

export type GitHubIdentityOutcome = 'linked' | 'taken' | 'failed'

export class GitHubIdentityError extends TaggedError('GitHubIdentityError')<{
  code:
    | 'github_not_configured'
    | 'exchange_failed'
    | 'user_fetch_failed'
    | 'member_not_found'
    | 'identity_taken'
    | 'database_failed'
  message: string
  cause?: unknown
}>() {}

const tokenResponseSchema = z.object({ access_token: z.string().min(1) })
const githubUserSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
})

const GITHUB_API_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'garden-app',
  'X-GitHub-Api-Version': '2022-11-28',
} as const

/** GitHub's user-authorization page for the Garden App's client id. */
export function buildGitHubUserAuthorizeUrl(args: {
  clientId: string
  redirectUri: string
  state: string
}) {
  const url = new URL('https://github.com/login/oauth/authorize')
  url.searchParams.set('client_id', args.clientId)
  url.searchParams.set('redirect_uri', args.redirectUri)
  url.searchParams.set('state', args.state)
  url.searchParams.set('allow_signup', 'false')
  return url.toString()
}

/**
 * Exchanges the authorization code for a short-lived user token and reads the
 * GitHub user it belongs to. GitHub answers a bad code with HTTP 200 and an
 * `error` body, so the token shape is validated rather than the status alone.
 */
export async function fetchVerifiedGitHubUser(args: {
  clientId: string
  clientSecret: string
  code: string
  redirectUri: string
  fetcher?: typeof fetch
}) {
  const fetcher = args.fetcher ?? fetch
  return Result.gen(async function* () {
    const tokenBody = yield* Result.await(
      Result.tryPromise({
        try: async () => {
          const response = await fetcher(
            'https://github.com/login/oauth/access_token',
            {
              method: 'POST',
              headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'User-Agent': GITHUB_API_HEADERS['User-Agent'],
              },
              body: JSON.stringify({
                client_id: args.clientId,
                client_secret: args.clientSecret,
                code: args.code,
                redirect_uri: args.redirectUri,
              }),
            },
          )
          return tokenResponseSchema.parse(await response.json())
        },
        catch: (cause) =>
          new GitHubIdentityError({
            code: 'exchange_failed',
            message: 'GitHub did not accept the sign-in code',
            cause,
          }),
      }),
    )

    const user = yield* Result.await(
      Result.tryPromise({
        try: async () => {
          const response = await fetcher('https://api.github.com/user', {
            headers: {
              ...GITHUB_API_HEADERS,
              Authorization: `Bearer ${tokenBody.access_token}`,
            },
          })
          if (!response.ok) {
            throw new Error(`GitHub /user returned ${response.status}`)
          }
          return githubUserSchema.parse(await response.json())
        },
        catch: (cause) =>
          new GitHubIdentityError({
            code: 'user_fetch_failed',
            message: 'Could not read the GitHub account',
            cause,
          }),
      }),
    )

    return Result.ok({
      githubUserId: String(user.id),
      githubLogin: user.login,
    })
  })
}

/** Reads the caller's own membership row (id + current GitHub id). */
async function readOwnMember(args: {
  db: Db
  workspaceId: string
  userId: string
}) {
  return Result.tryPromise({
    try: async () => {
      const [member] = await args.db
        .select({
          id: schema.member.id,
          githubUserId: schema.member.githubUserId,
        })
        .from(schema.member)
        .where(
          and(
            eq(schema.member.organizationId, args.workspaceId),
            eq(schema.member.userId, args.userId),
          ),
        )
        .limit(1)
      return member ?? null
    },
    catch: (cause) =>
      new GitHubIdentityError({
        code: 'database_failed',
        message: 'Failed to read membership',
        cause,
      }),
  }).then((result) =>
    result.andThen((member) =>
      member
        ? Result.ok(member)
        : Result.err(
            new GitHubIdentityError({
              code: 'member_not_found',
              message: 'You are not a member of this workspace',
            }),
          ),
    ),
  )
}

/**
 * Writes (or clears, when `identity` is null) the GitHub identity on the
 * caller's own member row. Only ever targets the row matching `userId`, so a
 * member cannot touch anyone else's link. A GitHub account already linked to
 * another member surfaces as `identity_taken` via the partial unique index.
 */
export async function setOwnGitHubIdentity(args: {
  db: Db
  workspaceId: string
  userId: string
  identity: { githubUserId: string; githubLogin: string } | null
}) {
  return Result.gen(async function* () {
    const member = yield* Result.await(readOwnMember(args))
    yield* Result.await(
      linkOrRefreshMemberGithubIdentity({
        db: args.db,
        workspaceId: args.workspaceId,
        memberId: member.id,
        existingGithubUserId: member.githubUserId,
        githubUserId: args.identity?.githubUserId ?? null,
        githubLogin: args.identity?.githubLogin ?? null,
      }).then((result) =>
        result.mapError(
          (error) =>
            new GitHubIdentityError({
              code: error.status === 409 ? 'identity_taken' : 'database_failed',
              message: error.message,
              cause: error,
            }),
        ),
      ),
    )
    return Result.ok({ memberId: member.id })
  })
}

/** Maps a failure to the coarse outcome shown to the member after redirect. */
export function identityOutcomeForError(
  error: GitHubIdentityError | { code: string },
): GitHubIdentityOutcome {
  return error.code === 'identity_taken' ? 'taken' : 'failed'
}

/**
 * Public origin for GitHub round-trips. Local dev runs behind the Vite proxy,
 * so it uses BETTER_AUTH_URL the same way the App install callback does
 * (`routes/api/github/setup.ts`); deployed Workers use the request origin.
 */
function publicOrigin(request: Request) {
  const requestOrigin = new URL(request.url).origin
  return appEnv.ENVIRONMENT === 'development' && appEnv.BETTER_AUTH_URL
    ? new URL(appEnv.BETTER_AUTH_URL).origin
    : requestOrigin
}

/**
 * The App's already-registered callback. GitHub requires the redirect_uri on
 * authorize and token exchange to match a registered callback URL, so the
 * identity flow reuses `/api/github/callback` instead of needing a new one.
 */
export function githubIdentityRedirectUri(request: Request) {
  return new URL('/api/github/callback', publicOrigin(request)).toString()
}

/** Lands the member on Home with the outcome for the one-shot notice. */
export function redirectWithIdentityOutcome(
  request: Request,
  outcome: GitHubIdentityOutcome,
) {
  const url = new URL('/home', publicOrigin(request))
  url.searchParams.set('github_identity', outcome)
  return new Response(null, {
    status: 302,
    headers: { location: url.toString() },
  })
}
