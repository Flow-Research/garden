import { Result } from 'better-result'

export type ResolvedGithubIdentity = {
  user_id: string
  login: string
}

export type GithubUserSuggestion = ResolvedGithubIdentity & {
  avatar_url: string | null
}

export type ResolveGithubLoginError = {
  message: string
}

const githubApiHeaders = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
} as const

export function normalizeGithubLogin(rawLogin: string) {
  return rawLogin.trim().replace(/^@+/, '')
}

/**
 * Typeahead via GitHub Search Users API (same surface as github.com user
 * search). Returns id+login+avatar so the dialog can confirm the person before
 * save. Unauthenticated search is rate-limited — keep queries short and
 * debounced in the UI.
 * @see https://docs.github.com/en/rest/search/search#search-users
 */
export async function searchGithubUsers(
  rawQuery: string,
): Promise<Result<GithubUserSuggestion[], ResolveGithubLoginError>> {
  const query = normalizeGithubLogin(rawQuery)
  if (query.length < 2) {
    return Result.ok([])
  }

  const responseResult = await Result.tryPromise({
    try: () =>
      fetch(
        `https://api.github.com/search/users?q=${encodeURIComponent(`${query} type:user`)}&per_page=8`,
        { headers: githubApiHeaders },
      ),
    catch: () => ({ message: 'Could not reach GitHub to search users' }),
  })
  if (responseResult.isErr()) return responseResult

  const response = responseResult.value
  if (response.status === 403 || response.status === 429) {
    return Result.err({
      message: 'GitHub user search is rate-limited. Try again in a minute.',
    })
  }
  if (!response.ok) {
    return Result.err({ message: 'Could not search GitHub users' })
  }

  const bodyResult = await Result.tryPromise({
    try: async () =>
      (await response.json()) as {
        items?: Array<{
          id?: unknown
          login?: unknown
          avatar_url?: unknown
          type?: unknown
        }>
      },
    catch: () => ({ message: 'Could not read GitHub search response' }),
  })
  if (bodyResult.isErr()) return bodyResult

  const items = bodyResult.value.items
  if (!Array.isArray(items)) {
    return Result.err({ message: 'GitHub returned an unexpected search payload' })
  }

  const suggestions: GithubUserSuggestion[] = []
  for (const item of items) {
    if (typeof item.id !== 'number' || typeof item.login !== 'string') continue
    // Issue assignees must be users; drop orgs even if search leaks them.
    if (item.type !== undefined && item.type !== 'User') continue
    suggestions.push({
      user_id: String(item.id),
      login: item.login,
      avatar_url:
        typeof item.avatar_url === 'string' ? item.avatar_url : null,
    })
  }

  return Result.ok(suggestions)
}

/**
 * Resolves a GitHub login to the stable numeric user id via the public Users
 * API. UI only asks for a username; the member row always stores the id+login
 * pair so renames stay refreshable. Never invents a handle on 404.
 */
export async function resolveGithubLogin(
  rawLogin: string,
): Promise<Result<ResolvedGithubIdentity, ResolveGithubLoginError>> {
  const login = normalizeGithubLogin(rawLogin)
  if (login.length === 0) {
    return Result.err({ message: 'Enter a GitHub username' })
  }

  const responseResult = await Result.tryPromise({
    try: () =>
      fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, {
        headers: githubApiHeaders,
      }),
    catch: () => ({ message: 'Could not reach GitHub to look up that user' }),
  })
  if (responseResult.isErr()) return responseResult

  const response = responseResult.value
  if (response.status === 404) {
    return Result.err({ message: 'No GitHub user with that username' })
  }
  if (!response.ok) {
    return Result.err({ message: 'Could not look up GitHub user' })
  }

  const bodyResult = await Result.tryPromise({
    try: async () =>
      (await response.json()) as {
        id?: unknown
        login?: unknown
        type?: unknown
      },
    catch: () => ({ message: 'Could not read GitHub user response' }),
  })
  if (bodyResult.isErr()) return bodyResult

  const id = bodyResult.value.id
  const resolvedLogin = bodyResult.value.login
  if (typeof id !== 'number' || typeof resolvedLogin !== 'string') {
    return Result.err({ message: 'GitHub returned an unexpected user payload' })
  }
  if (
    bodyResult.value.type !== undefined &&
    bodyResult.value.type !== 'User'
  ) {
    return Result.err({ message: 'That GitHub account is not a user' })
  }

  return Result.ok({
    user_id: String(id),
    login: resolvedLogin,
  })
}
