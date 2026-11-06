import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Issue, IssueRunEvent, TimelineEntry } from '@garden/core/types'
import type { StructuredQuestion } from '@garden/app-state/chat'
import { Skeleton } from '@garden/ui/components/ui/skeleton'
import { cn } from '@garden/ui/lib/utils'
import { useDevSettingsStore } from '@/features/settings/dev-settings-store'
import { api } from '@/lib/api'
import {
  issueActiveRunOptions,
  issueKeys,
  issueWorkProductsOptions,
} from '@/lib/issues/queries'
import {
  useResolvePermissionRequest,
  useReviewWorkProduct,
} from '@/lib/issues/mutations'
import { useNavigation } from '../../navigation'
import { ActiveRunPanel, LastRunSummary } from './active-run-panel'
import { RunPlanCard, type RunPlanTodo } from './run-plan-card'
import { WorkProductList } from './work-product-card'
import { useRunProgressInvalidation } from '../hooks/use-run-progress-invalidation'

function payloadObject(event: IssueRunEvent | undefined) {
  return event?.payload &&
    typeof event.payload === 'object' &&
    !Array.isArray(event.payload)
    ? event.payload
    : null
}

function pendingQuestionFromEvents(
  events: IssueRunEvent[],
): StructuredQuestion | null {
  const event = [...events]
    .reverse()
    .find((candidate) => candidate.event_type === 'issue_run:input_requested')
  const payload = payloadObject(event)
  if (!payload || typeof payload.question !== 'string') return null

  const options = Array.isArray(payload.options)
    ? payload.options
        .filter(
          (option): option is { label: string; description?: string } =>
            option !== null &&
            typeof option === 'object' &&
            'label' in option &&
            typeof option.label === 'string',
        )
        .map((option) => ({
          label: option.label,
          ...(typeof option.description === 'string'
            ? { description: option.description }
            : {}),
        }))
    : []

  return {
    id:
      typeof payload.id === 'string'
        ? payload.id
        : (event?.run_id ?? 'question'),
    question: payload.question,
    options,
    ...(typeof payload.header === 'string' ? { header: payload.header } : {}),
    ...(typeof payload.multiSelect === 'boolean'
      ? { multiSelect: payload.multiSelect }
      : {}),
  }
}

function timelineRunEvents(timeline: TimelineEntry[]): IssueRunEvent[] {
  const out: IssueRunEvent[] = []
  for (const entry of timeline) {
    if (entry.type === 'activity' && entry.event) out.push(entry.event)
  }
  return out
}

function latestPlanFromEvents(events: IssueRunEvent[]): RunPlanTodo[] | null {
  const event = [...events]
    .reverse()
    .find(
      (candidate) =>
        candidate.event_type === 'issue_run:tool_started' &&
        payloadObject(candidate)?.tool === 'update_plan',
    )
  const payload = payloadObject(event)
  if (!payload) return null
  const input = payload.input
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const todosRaw = (input as Record<string, unknown>).todos
  if (!Array.isArray(todosRaw)) return null
  const todos: RunPlanTodo[] = []
  for (const item of todosRaw) {
    if (
      item &&
      typeof item === 'object' &&
      'content' in item &&
      typeof (item as { content: unknown }).content === 'string' &&
      'status' in item &&
      ((item as { status: unknown }).status === 'pending' ||
        (item as { status: unknown }).status === 'in_progress' ||
        (item as { status: unknown }).status === 'completed') &&
      'activeForm' in item &&
      typeof (item as { activeForm: unknown }).activeForm === 'string'
    ) {
      const cast = item as RunPlanTodo
      todos.push({
        content: cast.content,
        status: cast.status,
        activeForm: cast.activeForm,
      })
    }
  }
  return todos.length > 0 ? todos : null
}

function pendingApprovalFromEvents(events: IssueRunEvent[]) {
  const event = [...events]
    .reverse()
    .find(
      (candidate) => candidate.event_type === 'issue_run:approval_requested',
    )
  const payload = payloadObject(event)
  if (!payload || typeof payload.title !== 'string') return null
  return {
    title: payload.title,
    body: typeof payload.body === 'string' ? payload.body : '',
    ...(typeof payload.targetLabel === 'string'
      ? { targetLabel: payload.targetLabel }
      : {}),
  }
}

function LastRunSummaryShell({
  pulse,
  children,
}: {
  pulse: boolean
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [active, setActive] = useState(false)
  useEffect(() => {
    if (!pulse) return
    setActive(true)
    if (ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    const timer = setTimeout(() => setActive(false), 1800)
    return () => clearTimeout(timer)
  }, [pulse])
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-lg border bg-card px-3 py-2 transition-shadow',
        active && 'ring-2 ring-brand/60 ring-offset-2 ring-offset-background',
      )}
    >
      {children}
    </div>
  )
}

function latestEventSummary(events: IssueRunEvent[]) {
  const event = events[events.length - 1]
  if (!event) return null
  return event.message?.trim() || event.event_type
}

function OutputSection({ children }: { children: ReactNode }) {
  return <section className="mt-8 space-y-2">{children}</section>
}

export function IssueOutputSurfaceFallback() {
  return (
    <section className="mt-8">
      <div className="rounded-lg border bg-card p-3">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="mt-3 h-3 w-full" />
        <Skeleton className="mt-2 h-3 w-5/6" />
        <Skeleton className="mt-2 h-3 w-2/3" />
      </div>
    </section>
  )
}

export function IssueRunSurfaceFallback() {
  return (
    <section className="space-y-3">
      <div className="rounded-lg border bg-card p-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-6 w-20 rounded-md" />
        </div>
        <Skeleton className="mt-3 h-2 w-full" />
      </div>
    </section>
  )
}

export function IssueOutputSurface({ issue }: { issue: Issue }) {
  const { searchParams } = useNavigation()
  const focus = searchParams.get('focus') ?? ''
  const [focusKind, focusId] = focus.split(':')
  const pulseWorkProductId =
    focusKind === 'wp_review' && focusId ? focusId : null
  const { data: workProducts } = useSuspenseQuery(
    issueWorkProductsOptions(issue.id),
  )
  const reviewMutation = useReviewWorkProduct(issue.id)

  if (workProducts.length === 0) return null

  return (
    <OutputSection>
      <WorkProductList
        workProducts={workProducts}
        connectorId={issue.source_summary?.connector_id ?? null}
        pulseId={pulseWorkProductId}
        pending={reviewMutation.isPending ? reviewMutation.variables : null}
        onApprove={(id) => reviewMutation.mutate({ id, action: 'approve' })}
        onRequestChanges={(id) =>
          reviewMutation.mutate({ id, action: 'request_changes' })
        }
        onApply={(id) => reviewMutation.mutateAsync({ id, action: 'apply' })}
      />
    </OutputSection>
  )
}

export function IssueRunSurface({
  issue,
  timeline,
  onAnswerQuestion,
  answeringQuestion = false,
}: {
  issue: Issue
  timeline: TimelineEntry[]
  onAnswerQuestion?: (answer: string | string[]) => void
  answeringQuestion?: boolean
}) {
  const queryClient = useQueryClient()
  const { searchParams } = useNavigation()
  const { data } = useSuspenseQuery(issueActiveRunOptions(issue.id))
  const debugMode = useDevSettingsStore((s) => s.debugMode)
  const focus = searchParams.get('focus') ?? ''
  const [focusKind, focusId] = focus.split(':')
  const run = data?.run ?? null
  const events = data?.events ?? []
  const persistedRunEvents = timelineRunEvents(timeline)
  const latestSeq = events.at(-1)?.seq ?? 0
  const latestRunStatus = run?.status ?? 'idle'
  useRunProgressInvalidation({
    issueId: issue.id,
    workspaceId: issue.workspace_id,
    runId: run?.id ?? null,
    status: latestRunStatus,
    latestSeq,
  })
  const pendingQuestion = pendingQuestionFromEvents(events)
  const pendingApprovalQuery = useQuery({
    queryKey: issueKeys.pendingApproval(issue.id),
    queryFn: () => api.getIssuePendingApproval(issue.id),
    enabled: run?.status === 'waiting_for_approval',
  })
  const pendingApprovalPreview =
    pendingApprovalQuery.data?.approval ?? pendingApprovalFromEvents(events)
  const approvalRequestId =
    pendingApprovalQuery.data?.approval?.request_id ?? null
  const plan = latestPlanFromEvents(
    persistedRunEvents.length > 0 ? persistedRunEvents : events,
  )
  const cancelMutation = useMutation({
    mutationFn: () => api.cancelRun(issue.id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: issueKeys.activeRun(issue.id),
      })
      queryClient.invalidateQueries({
        queryKey: issueKeys.detail(issue.workspace_id, issue.id),
      })
      queryClient.invalidateQueries({ queryKey: issueKeys.timeline(issue.id) })
    },
    onError: () => toast.error('Failed to stop run'),
  })
  const resolveApprovalMutation = useResolvePermissionRequest(issue.id)

  const pulseFocus =
    Boolean(run) &&
    ((focusKind === 'question' &&
      (!focusId || focusId === run?.id || focusId === pendingQuestion?.id)) ||
      focusKind === 'approval' ||
      (focusKind === 'run' && (!focusId || focusId === run?.id)))
  const pulseLastRun =
    Boolean(run) &&
    (focusKind === 'failed_run' || focusKind === 'blocked') &&
    (!focusId || focusId === run?.id)
  const showActive =
    run &&
    run.status !== 'succeeded' &&
    run.status !== 'cancelled' &&
    run.status !== 'failed' &&
    run.status !== 'blocked'
  const showLastRun =
    run &&
    (run.status === 'succeeded' ||
      run.status === 'cancelled' ||
      run.status === 'failed' ||
      run.status === 'blocked')

  return (
    <div className="space-y-3">
      {showActive && run && (
        <ActiveRunPanel
          agent={{ name: 'Garden' }}
          run={{ ...run, usage: run.usage ?? null }}
          lastEventSummary={latestEventSummary(events)}
          pendingQuestion={pendingQuestion}
          pendingApprovalPreview={pendingApprovalPreview}
          approvalDisabled={approvalRequestId === null}
          approvalPending={resolveApprovalMutation.isPending}
          pulseFocus={pulseFocus}
          debugMode={debugMode}
          onStop={() => cancelMutation.mutate()}
          onApprove={() => {
            if (approvalRequestId !== null) {
              resolveApprovalMutation.mutate({
                id: approvalRequestId,
                approved: true,
              })
            }
          }}
          onDeny={() => {
            if (approvalRequestId !== null) {
              resolveApprovalMutation.mutate({
                id: approvalRequestId,
                approved: false,
              })
            }
          }}
          onAnswerQuestion={onAnswerQuestion}
          answering={answeringQuestion}
        />
      )}

      {plan && <RunPlanCard todos={plan} streaming={Boolean(showActive)} />}

      {showLastRun && run && (
        <LastRunSummaryShell pulse={pulseLastRun}>
          <LastRunSummary
            debugMode={debugMode}
            lastRun={{
              status: run.status,
              finished_at: run.finished_at,
              usage: run.usage ?? null,
            }}
          />
        </LastRunSummaryShell>
      )}
    </div>
  )
}
