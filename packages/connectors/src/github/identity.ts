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
 * Before this gate: no check existed between the model's `owner` argument
 * and the installation account, on either the native or hosted surface.
 * After: a case-variant of the connected login is corrected to the
 * canonical casing, any other owner is rejected with the connected account
 * named, and a call with no canonical login available proceeds untouched
 * (degraded installs must not brick the tool surface).
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
 * - otherwise → reject with an actionable message naming both logins.
 */
export function resolveGithubToolOwner(args: {
  readonly accountLogin?: string | null
  readonly input: unknown
}): GithubOwnerGate {
  const account = args.accountLogin?.trim()
  if (!account) return { kind: 'proceed', input: args.input }

  const { input } = args
  if (typeof input !== 'object' || input === null) {
    return { kind: 'proceed', input }
  }
  if (!('owner' in input)) return { kind: 'proceed', input }

  const owner = (input as { owner: unknown }).owner
  if (typeof owner !== 'string' || owner.trim() === '') {
    return { kind: 'proceed', input }
  }

  const trimmed = owner.trim()
  if (trimmed.toLowerCase() !== account.toLowerCase()) {
    return {
      kind: 'reject',
      message: `GitHub owner "${trimmed}" is not the connected GitHub account "${account}". This installation only covers repositories under "${account}". Retry with owner "${account}", or call list_repositories to see the repositories available to this installation.`,
    }
  }
  // Canonicalize padded / re-cased values; an exact match keeps the original
  // reference so the common case allocates nothing.
  if (owner === account) return { kind: 'proceed', input }
  return {
    kind: 'proceed',
    input: { ...(input as Record<string, unknown>), owner: account },
  }
}
