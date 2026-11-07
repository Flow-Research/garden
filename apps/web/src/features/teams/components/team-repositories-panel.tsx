import { useDeferredValue, useState } from 'react'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useWorkspaceId } from '@garden/app-state/hooks'
import type {
  TeamRepository,
  TeamRepositoryImportState,
} from '@garden/core/types'
import { Button } from '@garden/ui/components/ui/button'
import { ConfirmDialog } from '@garden/ui/components/common/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@garden/ui/components/ui/dialog'
import { Input } from '@garden/ui/components/ui/input'
import { toast } from 'sonner'
import {
  useLinkTeamRepository,
  useRetryTeamRepositoryImport,
  useUnlinkTeamRepository,
} from '../mutations'
import {
  availableTeamRepositoryListOptions,
  teamRepositoryListOptions,
} from '../queries'

const IMPORT_STATE_LABEL: Record<TeamRepositoryImportState, string> = {
  pending: 'Import queued',
  importing: 'Importing issues…',
  ready: 'Synced',
  failed: 'Import failed',
}

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback

/**
 * Picks one repository the workspace's GitHub App can access. Repositories
 * already linked to a Team are listed but disabled, because a repository
 * feeds exactly one board.
 */
function LinkRepositoryDialog({
  teamId,
  onClose,
}: {
  teamId: string
  onClose: () => void
}) {
  const wsId = useWorkspaceId()
  const available = useQuery(availableTeamRepositoryListOptions(wsId, teamId))
  const link = useLinkTeamRepository()
  const [selected, setSelected] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const query = useDeferredValue(search.trim().toLowerCase())
  const repositories = (available.data ?? []).filter((repository) =>
    repository.full_name.toLowerCase().includes(query),
  )

  const handleLink = () => {
    if (selected === null) return
    link.mutate(
      { teamId, github_repo_id: selected },
      {
        onSuccess: (repository) => {
          toast.success(`Linked ${repository.full_name}`)
          onClose()
        },
        onError: (error) =>
          toast.error(errorMessage(error, 'Failed to link repository')),
      },
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !link.isPending && onClose()}>
      <DialogContent size="md" className="gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>Link a GitHub repository</DialogTitle>
          <DialogDescription>
            Open issues are imported onto this Team&apos;s board, and new GitHub
            issues appear here as they are opened.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-6 py-4">
          <Input
            aria-label="Search repositories"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search repositories..."
            value={search}
          />
          <div className="max-h-[22rem] overflow-y-auto">
            {available.isPending ? (
              <p className="py-10 text-center text-sm text-text-secondary">
                Loading repositories…
              </p>
            ) : available.isError ? (
              <p className="py-10 text-center text-sm text-text-secondary">
                {errorMessage(available.error, 'Could not load repositories')}
              </p>
            ) : repositories.length === 0 ? (
              <p className="py-10 text-center text-sm text-text-secondary">
                No repositories match.
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {repositories.map((repository) => {
                  const taken = repository.linked_team_id !== null
                  return (
                    <li key={repository.github_repo_id}>
                      <label
                        className={`flex items-center gap-3 px-3 py-2 ${
                          taken
                            ? 'cursor-not-allowed opacity-60'
                            : 'cursor-pointer hover:bg-background-main-secondary'
                        }`}
                      >
                        <input
                          type="radio"
                          name="team-repository-candidate"
                          checked={selected === repository.github_repo_id}
                          disabled={taken}
                          onChange={() =>
                            setSelected(repository.github_repo_id)
                          }
                          className="size-3.5 accent-primary"
                        />
                        <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                          <span className="truncate text-sm">
                            {repository.full_name}
                          </span>
                          <span className="shrink-0 text-xs text-text-secondary">
                            {taken
                              ? repository.linked_team_id === teamId
                                ? 'Linked here'
                                : 'Linked to another Team'
                              : repository.private
                                ? 'Private'
                                : 'Public'}
                          </span>
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
        <DialogFooter className="border-t px-6 pt-4 pb-6">
          <Button variant="outline" onClick={onClose} disabled={link.isPending}>
            Cancel
          </Button>
          <Button
            disabled={selected === null || link.isPending}
            onClick={handleLink}
          >
            {link.isPending ? 'Linking…' : 'Link repository'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Repositories tab of the Team detail page. Lists linked GitHub repositories
 * with their import state. Team managers can link, unlink, and retry a failed
 * import; everyone else sees the list read-only. The server's `can_manage`
 * check on each write stays the authorization boundary.
 */
export function TeamRepositoriesPanel({
  teamId,
  canManage,
}: {
  teamId: string
  canManage: boolean
}) {
  const wsId = useWorkspaceId()
  const { data: repositories } = useSuspenseQuery(
    teamRepositoryListOptions(wsId, teamId),
  )
  const unlink = useUnlinkTeamRepository()
  const retry = useRetryTeamRepositoryImport()
  const [linkOpen, setLinkOpen] = useState(false)
  const [toUnlink, setToUnlink] = useState<TeamRepository | null>(null)

  const handleUnlink = (repository: TeamRepository) =>
    unlink
      .mutateAsync({ teamId, repositoryId: repository.id })
      .then(() => {
        toast.success(`Unlinked ${repository.full_name}`)
      })
      .catch((error: unknown) => {
        toast.error(errorMessage(error, 'Failed to unlink repository'))
        throw error
      })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">
          Issues from linked repositories land on this Team&apos;s board and are
          assigned to the member whose GitHub account matches.
        </p>
        {canManage ? (
          <Button
            className="h-10 rounded-md px-3"
            onClick={() => setLinkOpen(true)}
          >
            Link repository
          </Button>
        ) : null}
      </div>

      {repositories.length === 0 ? (
        <p className="rounded-md border border-dashed px-6 py-10 text-center text-sm text-text-secondary">
          No repositories linked yet.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {repositories.map((repository) => (
            <li
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              key={repository.id}
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-medium">
                  {repository.full_name}
                </span>
                <span className="text-xs text-text-secondary">
                  {IMPORT_STATE_LABEL[repository.import_state]}
                </span>
              </span>
              {canManage ? (
                <span className="flex items-center gap-2">
                  {repository.import_state === 'failed' ? (
                    <Button
                      disabled={retry.isPending}
                      onClick={() =>
                        retry.mutate(
                          { teamId, repositoryId: repository.id },
                          {
                            onError: (error) =>
                              toast.error(
                                errorMessage(error, 'Failed to retry import'),
                              ),
                          },
                        )
                      }
                      variant="outline"
                    >
                      Retry import
                    </Button>
                  ) : null}
                  <Button
                    onClick={() => setToUnlink(repository)}
                    variant="outline"
                  >
                    Unlink
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {linkOpen ? (
        <LinkRepositoryDialog
          onClose={() => setLinkOpen(false)}
          teamId={teamId}
        />
      ) : null}
      <ConfirmDialog
        open={toUnlink !== null}
        onOpenChange={(open) => {
          if (!open) setToUnlink(null)
        }}
        title={`Unlink ${toUnlink?.full_name ?? 'repository'}?`}
        description="New GitHub issues stop arriving on this board. Issues already imported stay."
        confirmLabel="Unlink"
        pendingLabel="Unlinking…"
        tone="destructive"
        onConfirm={() =>
          toUnlink ? handleUnlink(toUnlink) : Promise.resolve()
        }
      />
    </div>
  )
}
