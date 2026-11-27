import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  attentionSchema,
  interventionListSchema,
} from '@garden/core/execution-host/interventions'
import { Button } from '@garden/ui/components/ui/button'
import { getApiTransport } from '@/lib/api'
import { useRef } from 'react'

export function AttentionRuns({
  workspace,
  open,
}: {
  workspace: string
  open: (id: string) => void
}) {
  const query = useQuery({
    queryKey: ['execution-host-attention', workspace],
    refetchInterval: 5000,
    retry: false,
    queryFn: async ({ signal }) => {
      const value = attentionSchema.parse(
        await getApiTransport().request(
          '/api/execution-hosts/?view=attention',
          { signal, headers: { 'X-Workspace-ID': workspace } },
        ),
      )
      if (value.workspaceId !== workspace) throw new Error('Workspace changed')
      return value.runs
    },
  })
  if (query.isError)
    return <p role="status">Could not load runs needing attention.</p>
  if (!query.data?.length) return null
  return (
    <section>
      <h3>Runs needing attention</h3>
      {query.data.map((run) => (
        <Button
          key={run.launchId}
          variant="outline"
          onClick={() => open(run.launchId)}
        >
          Review run {run.launchId}
        </Button>
      ))}
    </section>
  )
}

export function InterventionDecisions({
  workspace,
  launch,
}: {
  workspace: string
  launch: string
}) {
  const key = ['host-interventions', workspace, launch]
  const url =
    '/api/execution-hosts/runs/' + encodeURIComponent(launch) + '/interventions'
  const headers = { 'X-Workspace-ID': workspace }
  const client = useQueryClient()
  const ids = useRef(new Map<string, string>())
  const query = useQuery({
    queryKey: key,
    retry: false,
    refetchInterval: 5000,
    queryFn: async ({ signal }) => {
      const list = interventionListSchema.parse(
        await getApiTransport().request(url, { headers, signal }),
      )
      if (list.workspaceId !== workspace || list.launchId !== launch)
        throw new Error('Run changed')
      return list.interventions
    },
  })
  const answer = useMutation({
    mutationFn: async ({
      id,
      decision,
    }: {
      id: string
      decision: 'resume' | 'stop'
    }) => {
      const attempt = id + decision
      const answerId = ids.current.get(attempt) ?? crypto.randomUUID()
      ids.current.set(attempt, answerId)
      await getApiTransport().request(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ interventionId: id, decision, answerId }),
      })
    },
    onSettled: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: key }),
        client.invalidateQueries({
          queryKey: ['execution-host-attention', workspace],
        }),
      ])
    },
  })
  if (query.isError)
    return <p role="status">Could not verify this run’s pending decisions.</p>
  return (
    <>
      {query.data?.map(({ intervention, status, answer: recorded }) => (
        <section key={intervention.id}>
          <h4>
            {intervention.reason === 'allowance_unavailable'
              ? 'Provider allowance unavailable'
              : 'Host needs to verify the worker state'}
          </h4>
          <p>
            Run {intervention.runId} · Question {intervention.id}
          </p>
          {status === 'open' ? (
            <>
              <p>
                Resume releases this hold. The host checks permission and
                allowance before starting work. Stop requests cancellation. The
                host must confirm termination.
              </p>
              {intervention.reason === 'reconciliation_required' && (
                <p>
                  The host must reconcile the worker state before it can accept
                  Resume.
                </p>
              )}
              {(['resume', 'stop'] as const).map((choice) => (
                <Button
                  key={choice}
                  disabled={
                    answer.isPending ||
                    (choice === 'resume' &&
                      intervention.reason === 'reconciliation_required')
                  }
                  onClick={() =>
                    answer.mutate({ id: intervention.id, decision: choice })
                  }
                >
                  {choice === 'resume' ? 'Resume' : 'Stop'}
                </Button>
              ))}
            </>
          ) : (
            <p>
              {recorded
                ? 'Garden recorded ' +
                  recorded.decision +
                  '. See the host-reported run state below.'
                : 'Question ' + status}
            </p>
          )}
        </section>
      ))}
      {answer.isError && (
        <p role="alert">
          Garden could not confirm this choice. Check the current decision
          before retrying.
        </p>
      )}
    </>
  )
}
