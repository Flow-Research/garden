import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Result } from 'better-result'
import { Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { MemberWithUser } from '@garden/core/types'
import { Badge } from '@garden/ui/components/ui/badge'
import { Button } from '@garden/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@garden/ui/components/ui/dialog'
import { Input } from '@garden/ui/components/ui/input'
import { Label } from '@garden/ui/components/ui/label'
import { useAuthStore } from '@garden/app-state/auth'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { BrandGithubIcon } from '@/components/icons/brand-github-icon'
import { api } from '@/lib/api'
import { memberListOptions } from '@/lib/workspace/queries'
import {
  normalizeGithubLogin,
  resolveGithubLogin,
  searchGithubUsers,
  type GithubUserSuggestion,
  type ResolvedGithubIdentity,
  type ResolveGithubLoginError,
} from './resolve-github-login'

/** Pause after typing before hitting GitHub Search (10 req/min unauthenticated). */
const GITHUB_USER_SEARCH_DEBOUNCE_MS = 350

export function githubIdentityStatusLabel(member: {
  github_login: string | null
}) {
  return member.github_login ? `@${member.github_login}` : 'GitHub not linked'
}

/**
 * Account settings card showing the current user's workspace-member GitHub
 * identity, read-only. Before: members could self-link any GitHub id here,
 * which let them claim another person's account and its mirrored issue
 * assignments. Now only owners/admins edit identities from Members until
 * Garden verifies ownership via GitHub OAuth (docs/reference/known-gaps.md).
 */
export function GithubWorkspaceIdentitySection() {
  const user = useAuthStore((state) => state.user)
  const workspace = useWorkspaceStore((state) => state.workspace)
  const wsId = useWorkspaceId()
  const { data: members = [], isPending } = useQuery({
    ...memberListOptions(wsId),
    enabled: Boolean(wsId),
  })

  if (!workspace || !user) return null

  const membership =
    members.find((member) => member.user_id === user.id) ?? null

  return (
    <section className="space-y-5">
      <header>
        <h2 className="text-base font-semibold">GitHub identity</h2>
        <p className="text-sm text-muted-foreground">
          Agents use this GitHub user to assign mirrored GitHub issues to you. A
          workspace owner or admin links it from Members. This is separate from
          installing the GitHub App under Connections.
        </p>
      </header>

      {isPending || !membership ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading membership...
        </div>
      ) : (
        <div className="flex min-w-0 items-center gap-3 rounded-lg border p-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background">
            <BrandGithubIcon className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">GitHub</p>
              <Badge
                variant={membership.github_login ? 'secondary' : 'outline'}
              >
                {membership.github_login ? 'Linked' : 'Not linked'}
              </Badge>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {membership.github_login
                ? `@${membership.github_login}`
                : 'Ask a workspace owner or admin to link your GitHub user.'}
            </p>
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * Search → pick suggestion (or exact resolve) → PATCH member github_* pair.
 * Used from Members by owners/admins. Suggestions use GitHub Search Users so typos
 * are caught before save; selecting a row confirms the intended account.
 */
export function GithubIdentityLinkDialog({
  open,
  onOpenChange,
  workspaceId,
  member,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  member: MemberWithUser
  onSaved: () => Promise<unknown> | unknown
}) {
  const [login, setLogin] = useState(member.github_login ?? '')
  const [debouncedSearch, setDebouncedSearch] = useState(
    normalizeGithubLogin(member.github_login ?? ''),
  )
  const [selected, setSelected] = useState<ResolvedGithubIdentity | null>(null)
  const [busy, setBusy] = useState(false)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchTerm = normalizeGithubLogin(debouncedSearch)
  const typedLogin = normalizeGithubLogin(login)

  const clearSearchTimer = () => {
    if (searchTimerRef.current !== null) {
      clearTimeout(searchTimerRef.current)
      searchTimerRef.current = null
    }
  }

  const scheduleSearch = (value: string) => {
    clearSearchTimer()
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(normalizeGithubLogin(value))
      searchTimerRef.current = null
    }, GITHUB_USER_SEARCH_DEBOUNCE_MS)
  }

  const searchQuery = useQuery({
    queryKey: ['github-user-search', searchTerm] as const,
    enabled: open && searchTerm.length >= 2,
    staleTime: 30_000,
    queryFn: async () => {
      const result = await searchGithubUsers(searchTerm)
      return result.match({
        ok: (suggestions) => suggestions,
        err: (error) => {
          throw new Error(error.message)
        },
      })
    },
  })

  const suggestions = searchQuery.data ?? []
  const selectedMatchesInput =
    selected !== null &&
    selected.login.toLowerCase() === typedLogin.toLowerCase()
  const searchPending =
    typedLogin.length >= 2 &&
    typedLogin.toLowerCase() !== searchTerm.toLowerCase()

  /** Callers mount this dialog only while open, so open=true remounts fresh state. */
  const handleOpenChange = (next: boolean) => {
    clearSearchTimer()
    if (!next) setDebouncedSearch('')
    onOpenChange(next)
  }

  const handleSelectSuggestion = (suggestion: GithubUserSuggestion) => {
    clearSearchTimer()
    setLogin(suggestion.login)
    setDebouncedSearch(suggestion.login)
    setSelected({
      user_id: suggestion.user_id,
      login: suggestion.login,
    })
  }

  const handleLoginChange = (value: string) => {
    setLogin(value)
    scheduleSearch(value)
    const normalized = normalizeGithubLogin(value)
    if (selected && selected.login.toLowerCase() !== normalized.toLowerCase()) {
      setSelected(null)
    }
  }

  const handleSave = async () => {
    setBusy(true)
    const resolved: Result<ResolvedGithubIdentity, ResolveGithubLoginError> =
      selectedMatchesInput
        ? Result.ok(selected)
        : await resolveGithubLogin(login)
    const result = await resolved.match({
      ok: (identity) =>
        Result.tryPromise({
          try: () =>
            api.updateMember(workspaceId, member.id, {
              github_user_id: identity.user_id,
              github_login: identity.login,
            }),
          catch: (cause) => ({
            message:
              cause instanceof Error
                ? cause.message
                : 'Failed to link GitHub identity',
          }),
        }),
      err: (error) => Promise.resolve(Result.err(error)),
    })
    setBusy(false)

    await result.match({
      ok: async () => {
        await onSaved()
        toast.success(
          member.github_login
            ? 'GitHub identity updated'
            : 'GitHub identity linked',
        )
        onOpenChange(false)
      },
      err: async (error) => {
        toast.error(error.message)
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {member.github_login ? 'Update GitHub identity' : 'Link GitHub'}
          </DialogTitle>
          <DialogDescription>
            Search for the GitHub user for {member.name || member.email}, then
            pick the matching account. Garden stores the stable user id plus
            current login for mirrored issue assignees.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="github-login">GitHub username</Label>
          <Input
            id="github-login"
            value={login}
            onChange={(event) => handleLoginChange(event.target.value)}
            placeholder="Start typing a username…"
            autoComplete="off"
            disabled={busy}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && login.trim()) void handleSave()
            }}
          />

          {selectedMatchesInput ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Check className="size-3.5 shrink-0" aria-hidden="true" />
              Selected @{selected.login}
            </p>
          ) : typedLogin.length < 2 ? (
            <p className="text-xs text-muted-foreground">
              Type at least 2 characters to search GitHub users.
            </p>
          ) : searchPending || searchQuery.isFetching ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Searching GitHub…
            </p>
          ) : searchQuery.isError ? (
            <p className="text-xs text-destructive">
              {searchQuery.error instanceof Error
                ? searchQuery.error.message
                : 'Could not search GitHub users'}
            </p>
          ) : suggestions.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No users matched. Check the spelling, or save to try an exact
              lookup.
            </p>
          ) : (
            <ul
              className="max-h-48 divide-y overflow-y-auto rounded-md border"
              role="listbox"
              aria-label="GitHub user suggestions"
            >
              {suggestions.map((suggestion) => {
                const isActive =
                  selectedMatchesInput &&
                  selected.user_id === suggestion.user_id
                return (
                  <li key={suggestion.user_id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      disabled={busy}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
                      onClick={() => handleSelectSuggestion(suggestion)}
                    >
                      {suggestion.avatar_url ? (
                        <img
                          src={suggestion.avatar_url}
                          alt=""
                          className="size-7 rounded-full"
                        />
                      ) : (
                        <span className="flex size-7 items-center justify-center rounded-full border bg-background">
                          <BrandGithubIcon className="size-3.5" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        @{suggestion.login}
                      </span>
                      {isActive ? (
                        <Check
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy || login.trim().length === 0}
            onClick={() => void handleSave()}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {busy ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
