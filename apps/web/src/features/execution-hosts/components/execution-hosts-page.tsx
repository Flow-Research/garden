import { AttentionRuns, InterventionDecisions } from './intervention-decisions'
import { useState, type ReactNode } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { useWorkspaceId } from '@garden/app-state/hooks'
import type {
  HostEvent,
  HostSummary,
} from '@garden/core/execution-host/contracts'
import { LoadError } from '@garden/ui/components/common/load-error'
import { Badge } from '@garden/ui/components/ui/badge'
import { Button } from '@garden/ui/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@garden/ui/components/ui/empty'
import { Input } from '@garden/ui/components/ui/input'
import { Label } from '@garden/ui/components/ui/label'
import { Skeleton } from '@garden/ui/components/ui/skeleton'
import { executionHostReadFailure, type ExecutionHostReadFailure } from '../api'
import {
  executionHostDirectoryOptions,
  executionHostRunOptions,
} from '../queries'
import { hostFreshness, runStatus, type RunStatus } from '../status'

const freshnessLabels = {
  recent: 'Reported recently',
  stale: 'Stale',
  never_reported: 'Never reported',
  revoked: 'Revoked',
} as const

const stateLabels: Record<HostEvent['state'], string> = {
  reserved: 'Reserved',
  running: 'Running',
  verifying: 'Verifying',
  cancel_requested: 'Cancellation received by host',
  reconciling: 'Reconciling',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

const refusals: Record<
  Exclude<ExecutionHostReadFailure, 'unavailable' | 'not_found'>,
  { title: string; description: string }
> = {
  disabled: {
    title: 'Execution hosts are disabled',
    description:
      'The engineering pilot is not configured for this Garden deployment.',
  },
  signed_out: {
    title: 'Sign in again',
    description: 'Garden could not confirm a current session for this read.',
  },
  refused: {
    title: 'You cannot view execution hosts',
    description:
      'Garden refused this read. The pilot operator with workspace administration can view the hosts of this workspace.',
  },
}

function Time({ at }: { at: number }) {
  return (
    <time dateTime={new Date(at).toISOString()}>
      {new Date(at).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'medium',
      })}
    </time>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{children}</dd>
    </div>
  )
}

function Notice({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <Empty className="border border-border">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

/** Names when Garden last received a good answer, and says so when a later refresh failed. */
function SyncLine({
  receivedAt,
  refreshFailed,
  refreshing,
  onRefresh,
}: {
  receivedAt: number
  refreshFailed: boolean
  refreshing: boolean
  onRefresh: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <p>
        Last synchronized <Time at={receivedAt} />
      </p>
      {refreshFailed ? (
        <p role="alert" className="text-text-danger-secondary">
          The last refresh failed. This data can be out of date.
        </p>
      ) : null}
      <Button
        variant="outline"
        size="sm"
        disabled={refreshing}
        onClick={onRefresh}
      >
        {refreshing ? 'Refreshing…' : 'Refresh'}
      </Button>
    </div>
  )
}

function HostFacts({
  host,
  observedAt,
}: {
  host: HostSummary
  observedAt: number
}) {
  const freshness = hostFreshness(host, observedAt)
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="break-all font-mono text-sm">{host.hostId}</span>
        <Badge variant={freshness === 'recent' ? 'secondary' : 'outline'}>
          {freshnessLabels[freshness]}
        </Badge>
      </div>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Enrollment">
          {host.status === 'enrolled' ? 'Enrolled' : 'Revoked'}
        </Fact>
        <Fact label="Last seen">
          {host.lastSeenAt === null ? 'Never' : <Time at={host.lastSeenAt} />}
        </Fact>
        <Fact label="Repositories">{host.repositories.join(', ')}</Fact>
        <Fact label="Agent">{host.agent}</Fact>
        <Fact label="Key generation">{host.keyGeneration}</Fact>
        <Fact label="Capability digest">
          <span className="font-mono" title={host.capabilityDigest}>
            {host.capabilityDigest.slice(0, 12)}
          </span>
        </Fact>
      </dl>
    </>
  )
}

function describeRun(status: RunStatus): {
  label: string
  detail: string
  lastReported?: HostEvent['state'] | null
} {
  switch (status.kind) {
    case 'not_started':
      return {
        label: 'Not started',
        detail: status.cancellationRequested
          ? 'Cancellation was requested and the host did not start this run.'
          : 'The host declined this launch before it started.',
      }
    case 'finished':
      return {
        label: stateLabels[status.state],
        detail:
          status.cancellationRequested && status.state !== 'cancelled'
            ? 'Termination confirmed by the host. Cancellation was requested before the run ended.'
            : 'Termination confirmed by the host.',
      }
    case 'cancellation_requested':
      return {
        label: 'Cancellation requested',
        detail:
          'Termination is not confirmed. The host has not reported that the process stopped.',
        lastReported: status.lastReported,
      }
    case 'waiting_for_host':
      return {
        label: 'Waiting for host',
        detail: 'The host has not acknowledged this launch.',
      }
    case 'acknowledged':
      return {
        label: 'Acknowledged',
        detail: 'The host acknowledged this launch and has sent no event.',
      }
    case 'reported':
      return {
        label: stateLabels[status.state],
        detail:
          status.state === 'cancel_requested'
            ? 'Termination is not confirmed. The host has not reported that the process stopped.'
            : 'Last state that the host reported. Termination is not confirmed.',
      }
    case 'stale':
      return {
        label: 'Stale',
        detail: {
          stale:
            'The host has not reported recently. The current state is not known.',
          never_reported:
            'The host has never reported. The current state is not known.',
          revoked:
            'The host enrollment or this delivery is revoked. Termination is not confirmed.',
        }[status.cause],
        lastReported: status.lastReported,
      }
    case 'unknown':
      return {
        label: 'Unknown',
        detail: 'Garden could not establish the current state of this run.',
        lastReported: status.lastReported,
      }
  }
}

function RunDetail({ wsId, launchId }: { wsId: string; launchId: string }) {
  const run = useInfiniteQuery(executionHostRunOptions(wsId, launchId))
  const failure = run.error ? executionHostReadFailure(run.error) : null
  const latest = run.data?.pages.at(-1)

  if (failure === 'not_found')
    return (
      <Notice
        title="Run not found"
        description="No launch with this ID exists in the current workspace."
      />
    )
  if (failure && failure !== 'unavailable')
    return <Notice {...refusals[failure]} />
  if (!latest)
    return run.isError ? (
      <LoadError
        message="Could not load this run."
        onRetry={() => void run.refetch()}
        retrying={run.isFetching}
      />
    ) : (
      <Skeleton className="h-40 w-full" />
    )

  const events = run.data?.pages.flatMap((page) => page.events) ?? []
  const status = describeRun(
    runStatus(latest, latest.receivedAt, failure === null),
  )
  return (
    <div className="space-y-6">
      <InterventionDecisions workspace={wsId} launch={launchId} />
      <SyncLine
        receivedAt={latest.receivedAt}
        refreshFailed={failure !== null}
        refreshing={run.isFetching}
        onRefresh={() => void run.refetch()}
      />
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-medium">Run state</h4>
          <Badge variant="outline" data-testid="run-state">
            {status.label}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{status.detail}</p>
        {status.lastReported ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Last reported state: {stateLabels[status.lastReported]}
          </p>
        ) : null}
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Cancellation">
            {latest.cancellation === 'requested' ? 'Requested' : 'None'}
          </Fact>
          <Fact label="Termination">
            {
              {
                'not-started': 'Not started',
                'host-confirmed': 'Confirmed by host',
                unconfirmed: 'Not confirmed',
              }[latest.termination]
            }
          </Fact>
          <Fact label="Delivery">
            {
              {
                pending: 'Pending',
                acknowledged: 'Acknowledged',
                revoked: 'Revoked',
              }[latest.deliveryStatus]
            }
          </Fact>
          <Fact label="Launch ID">
            <span className="break-all font-mono">{latest.launchId}</span>
          </Fact>
          <Fact label="Run ID">
            {latest.runId === null ? (
              'None'
            ) : (
              <span className="break-all font-mono">{latest.runId}</span>
            )}
          </Fact>
          <Fact label="Repository">{latest.job.repository}</Fact>
          <Fact label="Lane">{latest.job.lane}</Fact>
          <Fact label="Objective">{latest.job.objective}</Fact>
          <Fact label="Source revision">
            <span className="font-mono" title={latest.job.sourceRevision}>
              {latest.job.sourceRevision.slice(0, 12)}
            </span>
          </Fact>
        </dl>
      </div>
      <div>
        <h4 className="text-sm font-medium">Host</h4>
        <div className="mt-2">
          <HostFacts host={latest.host} observedAt={latest.receivedAt} />
        </div>
      </div>
      <div>
        <h4 className="text-sm font-medium">Events</h4>
        <p className="mt-1 text-sm text-muted-foreground">
          Showing {events.length} of {latest.lastSequence} events.
        </p>
        {events.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-border">
                  <th scope="col" className="py-2 pr-4 font-normal">
                    Sequence
                  </th>
                  <th scope="col" className="py-2 pr-4 font-normal">
                    Time
                  </th>
                  <th scope="col" className="py-2 pr-4 font-normal">
                    State
                  </th>
                  <th scope="col" className="py-2 pr-4 font-normal">
                    Reason
                  </th>
                  <th scope="col" className="py-2 font-normal">
                    Evidence digest
                  </th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.sequence} className="border-b border-border">
                    <td className="py-2 pr-4 font-mono">{event.sequence}</td>
                    <td className="py-2 pr-4">
                      <Time at={event.at} />
                    </td>
                    <td className="py-2 pr-4">{stateLabels[event.state]}</td>
                    <td className="py-2 pr-4 font-mono">{event.reason}</td>
                    <td className="py-2 font-mono" title={event.evidenceDigest}>
                      {event.evidenceDigest?.slice(0, 12) ?? 'None'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {run.hasNextPage ? (
          <Button
            className="mt-3"
            variant="outline"
            size="sm"
            disabled={run.isFetchingNextPage}
            onClick={() => void run.fetchNextPage()}
          >
            {run.isFetchingNextPage ? 'Loading…' : 'Load more events'}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

const launchIdSchema = z.string().uuid()

function RunSection({
  wsId,
  launchId,
  onOpenRun,
}: {
  wsId: string
  launchId: string | undefined
  onOpenRun: (launchId: string | undefined) => void
}) {
  const [draft, setDraft] = useState(launchId ?? '')
  const [invalid, setInvalid] = useState(false)
  const selected = launchIdSchema.safeParse(launchId)
  return (
    <section aria-labelledby="execution-host-run-heading" className="mt-10">
      <h3 id="execution-host-run-heading" className="text-base font-medium">
        Run status
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Garden has no list of runs yet. Enter the launch ID of a run in this
        workspace to read its state.
      </p>
      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          const parsed = launchIdSchema.safeParse(draft.trim())
          setInvalid(!parsed.success)
          if (parsed.success) onOpenRun(parsed.data)
        }}
      >
        <div className="min-w-0 flex-1 sm:max-w-md">
          <Label htmlFor="execution-host-launch-id">Launch ID</Label>
          <Input
            id="execution-host-launch-id"
            className="mt-1 font-mono"
            value={draft}
            aria-invalid={invalid}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
        <Button type="submit" variant="outline">
          Show run
        </Button>
      </form>
      {invalid ? (
        <p role="alert" className="mt-2 text-sm text-text-danger-secondary">
          Enter a launch ID in UUID format.
        </p>
      ) : null}
      {selected.success ? (
        <div className="mt-6">
          <RunDetail key={selected.data} wsId={wsId} launchId={selected.data} />
        </div>
      ) : launchId ? (
        <p role="alert" className="mt-2 text-sm text-text-danger-secondary">
          The launch ID in the address is not a UUID.
        </p>
      ) : null}
    </section>
  )
}

/**
 * Read-only status of the external execution hosts of the current workspace.
 * Every fact comes from the member read routes under `/api/execution-hosts`.
 * The page starts no launch, cancellation or other host effect.
 */
export function ExecutionHostsPage({
  launchId,
  onOpenRun,
}: {
  launchId: string | undefined
  onOpenRun: (launchId: string | undefined) => void
}) {
  const wsId = useWorkspaceId()
  const directory = useInfiniteQuery(executionHostDirectoryOptions(wsId))
  const failure = directory.error
    ? executionHostReadFailure(directory.error)
    : null
  const pages = directory.data?.pages
  const latest = pages?.at(-1)
  const refused =
    failure !== null && failure !== 'unavailable' && failure !== 'not_found'
      ? refusals[failure]
      : null

  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight">Execution hosts</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Review host status and answer questions about paused runs in this
        workspace.
      </p>
      <section aria-labelledby="execution-host-list-heading" className="mt-6">
        <h3 id="execution-host-list-heading" className="sr-only">
          Enrolled hosts
        </h3>
        {refused ? (
          <Notice {...refused} />
        ) : !pages || !latest ? (
          directory.isError ? (
            <LoadError
              message="Could not load execution hosts."
              onRetry={() => void directory.refetch()}
              retrying={directory.isFetching}
            />
          ) : (
            <Skeleton className="h-24 w-full" />
          )
        ) : (
          <div className="space-y-4">
            <SyncLine
              receivedAt={latest.receivedAt}
              refreshFailed={failure !== null}
              refreshing={directory.isFetching}
              onRefresh={() => void directory.refetch()}
            />
            {pages.every((page) => page.hosts.length === 0) ? (
              <Notice
                title="No host is enrolled"
                description="This workspace has no enrolled execution host."
              />
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {pages.flatMap((page) =>
                  page.hosts.map((host) => (
                    <li key={host.hostId} className="p-4">
                      <HostFacts host={host} observedAt={page.observedAt} />
                    </li>
                  )),
                )}
              </ul>
            )}
            {directory.hasNextPage ? (
              <Button
                variant="outline"
                size="sm"
                disabled={directory.isFetchingNextPage}
                onClick={() => void directory.fetchNextPage()}
              >
                {directory.isFetchingNextPage ? 'Loading…' : 'Load more hosts'}
              </Button>
            ) : null}
          </div>
        )}
      </section>
      {refused || !latest ? null : (
        <>
          <AttentionRuns workspace={wsId} open={onOpenRun} />
          <RunSection
            key={`${wsId}:${launchId ?? ''}`}
            wsId={wsId}
            launchId={launchId}
            onOpenRun={onOpenRun}
          />
        </>
      )}
    </div>
  )
}
