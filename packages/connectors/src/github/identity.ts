import { getGitHubAppInstallation } from '../github-app'

/**
 * Owner identity gate for GitHub tool calls.
 *
 * Why: the model supplies `owner`/`repo` free-hand on every repo-scoped
 * GitHub tool, so it can hallucinate an org name or re-case the real one;
 * a wrong owner reaches `api.github.com` and fails as a bare 404 (#332:
 * `flowresearch/garden` instead of `Flow-Research/garden`). The workspace's
 * GitHub App installation covers exactly one account, and
 * `github_app_installation.account_login` (written from GitHub's install
 * API) is the canonical casing for it.
 *
 * A case variant of the connected login is corrected to canonical casing.
 * A mutating call with another destination is rejected, while reads may
 * address public repositories outside the installation. Forks use `owner`
 * for the source and `organization` for the optional destination.
 *
 * Industry pattern: resolve identity from the authenticated session rather
 * than the model's memory (gh CLI `--repo`/`GH_REPO`/git-remote precedence;
 * github/github-mcp-server#562 where a guessed owner 404'd).
 * Ref: packages/agent-runtime/src/instructions/foundation.md (inventory
 * preflight), docs/concepts/architecture/connectors.md.
 */
export type GithubOwnerGate =
  | {
      readonly kind: 'proceed'
      /** Possibly corrected input; identical reference when unchanged. */
      readonly input: unknown
    }
  | {
      readonly kind: 'reject'
      readonly message: string
    }

/**
 * Validates (and when possible corrects) the `owner` field of a GitHub tool
 * call against the connected installation's account login.
 *
 * Pure and synchronous so both tool surfaces (native `github.*` and hosted
 * `github-mcp.*`) and the work-product writeback path can run the same
 * check before any GitHub request is built.
 *
 * Rules:
 * - no canonical login (null/blank) → proceed; there is nothing to check
 *   against and the install health gate already owns degraded-install policy;
 * - input is not an object or has no `owner` key (e.g. `list_repositories`,
 *   `search_repositories`) → proceed;
 * - `owner` missing/empty/non-string → proceed; schema decode or GitHub
 *   owns that failure;
 * - exact match → proceed;
 * - case-insensitive match → proceed with `owner` set to the canonical
 *   login (GitHub logins are case-insensitive, but paths are not reliably
 *   so, and the canonical casing keeps transcripts unambiguous);
 * - a different target → reject on `write`, proceed untouched on `read`.
 */
export function resolveGithubToolOwner(args: {
  readonly accountLogin?: string | null
  readonly input: unknown
  /** Read calls may address any owner; only writes are account-scoped. */
  readonly mode: 'read' | 'write'
  /** Forks name their destination in `organization`; omitted means the install account. */
  readonly ownerField?: 'owner' | 'organization'
}): GithubOwnerGate {
  const account = args.accountLogin?.trim()
  if (!account) return { kind: 'proceed', input: args.input }

  const { input } = args
  if (typeof input !== 'object' || input === null) {
    return { kind: 'proceed', input }
  }
  const ownerField = args.ownerField ?? 'owner'
  if (!(ownerField in input)) return { kind: 'proceed', input }

  const owner = (input as Record<string, unknown>)[ownerField]
  if (typeof owner !== 'string' || owner.trim() === '') {
    return { kind: 'proceed', input }
  }

  const trimmed = owner.trim()
  if (trimmed.toLowerCase() !== account.toLowerCase()) {
    if (args.mode === 'read') return { kind: 'proceed', input }
    return {
      kind: 'reject',
      message: `GitHub ${ownerField} "${trimmed}" is not the connected GitHub account "${account}". This installation only covers writes to repositories under "${account}". Retry with ${ownerField} "${account}", or call list_repositories to see the repositories available to this installation.`,
    }
  }
  // Canonicalize padded / re-cased values; an exact match keeps the original
  // reference so the common case allocates nothing.
  if (owner === account) return { kind: 'proceed', input }
  return {
    kind: 'proceed',
    input: { ...(input as Record<string, unknown>), [ownerField]: account },
  }
}

/** Confirms a write destination against GitHub when the saved login disagrees. */
export async function resolveGithubWriteOwner(args: {
  readonly accountLogin?: string | null
  readonly installationId: string
  readonly env: Record<string, string | undefined>
  readonly input: unknown
  readonly ownerField?: 'owner' | 'organization'
}): Promise<GithubOwnerGate> {
  const cached = resolveGithubToolOwner({ ...args, mode: 'write' })
  if (cached.kind === 'proceed' && args.accountLogin?.trim()) return cached

  const ownerField = args.ownerField ?? 'owner'
  const input = args.input
  const destination =
    typeof input === 'object' && input !== null && ownerField in input
      ? (input as Record<string, unknown>)[ownerField]
      : undefined
  if (typeof destination !== 'string' || !destination.trim()) {
    return args.accountLogin?.trim()
      ? cached
      : {
          kind: 'reject',
          message: 'GitHub installation owner could not be confirmed.',
        }
  }

  const installation = await getGitHubAppInstallation({
    env: args.env,
    installationId: args.installationId,
  })
  const login = installation.isOk()
    ? installation.value.account?.login?.trim()
    : null
  if (!login) {
    return cached.kind === 'reject'
      ? cached
      : {
          kind: 'reject',
          message: 'GitHub installation owner could not be confirmed.',
        }
  }
  return resolveGithubToolOwner({
    accountLogin: login,
    input,
    mode: 'write',
    ownerField,
  })
}
