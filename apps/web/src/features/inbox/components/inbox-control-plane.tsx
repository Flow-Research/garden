import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Option } from 'effect'
import type { StructuredQuestion } from '@garden/app-state/chat'
import type {
  InboxItem,
  IssueRunEvent,
  IssueWorkProduct,
} from '@garden/core/types'
import { getConnectorById } from '@garden/connectors'
import { api } from '@/lib/api'
import { executorOAuthStartUrl } from '@/lib/api/executor'
import { connectionListOptions } from '@/lib/workspace/queries'
import { Button } from '@garden/ui/components/ui/button'
import {
  issueActiveRunOptions,
  issueDetailOptions,
  issueKeys,
  issueWorkProductsOptions,
} from '@/lib/issues/queries'
import { inboxKeys } from '@/lib/inbox/queries'
import { useWorkspaceId } from '@garden/app-state/hooks'
import {
  ApprovalCard,
  ConnectorWriteBody,
} from '@/features/issues/components/approval-card'
import { QuestionCard } from '@/features/issues/components/question-card'
import {
  WorkProductCard,
  WorkProductList,
} from '@/features/issues/components/work-product-card'
import { LastRunSummary } from '@/features/issues/components/active-run-panel'
import { toast } from 'sonner'

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

function workProductForItem(item: InboxItem, workProducts: IssueWorkProduct[]) {
  const targetId = item.details?.work_product_id
  if (targetId) {
    const target = workProducts.find((wp) => wp.id === targetId)
    if (target) return target
  }
  return (
    workProducts.find(
      (wp) => wp.status === 'review' && wp.review_state === 'pending',
    ) ??
    workProducts[0] ??
    null
  )
}

function useInboxActionInvalidation(issueId: string | null) {
  const queryClient = useQueryClient()
  const wsId = useWorkspaceId()
  return () => {
    queryClient.invalidateQueries({
      queryKey: inboxKeys.list(wsId),
      exact: true,
    })
    queryClient.invalidateQueries({
      queryKey: issueKeys.list(wsId),
      exact: true,
      refetchType: 'none',
    })
    if (issueId) {
      queryClient.invalidateQueries({
        queryKey: issueKeys.activeRun(issueId),
        exact: true,
      })
      queryClient.invalidateQueries({
        queryKey: issueKeys.detail(wsId, issueId),
        exact: true,
      })
      queryClient.invalidateQueries({
        queryKey: issueKeys.timeline(issueId),
        exact: true,
      })
      queryClient.invalidateQueries({
        queryKey: issueKeys.workProducts(issueId),
        exact: true,
      })
      queryClient.invalidateQueries({
        queryKey: ['issue-pending-approval', issueId],
        exact: true,
      })
    }
  }
}

type WorkProductReviewAction = 'approve' | 'request_changes' | 'apply'

function useWorkProductReviewMutation(issueId: string | null) {
  const invalidate = useInboxActionInvalidation(issueId)
  return useMutation({
    mutationFn: (vars: { id: string; action: WorkProductReviewAction }) =>
      api.reviewWorkProduct(vars.id, { action: vars.action }),
    onSuccess: invalidate,
    onError: () => toast.error('Failed to update work product'),
  })
}

function BrainProposalInboxAction({ item }: { item: InboxItem }) {
  const invalidate = useInboxActionInvalidation(item.issue_id)
  const proposalId = item.details?.proposal_id
  const resolveMutation = useMutation({
    mutationFn: (action: 'approve' | 'reject') =>
      api.resolveBrainProposal({ id: proposalId ?? '', action }),
    onSuccess: invalidate,
    onError: () => toast.error('Failed to update knowledge proposal'),
  })

  if (!proposalId) return null

  return (
    <div className="space-y-3 rounded-lg border bg-card px-3 py-3">
      <p className="whitespace-pre-wrap text-sm text-foreground">{item.body}</p>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => resolveMutation.mutate('approve')}
          disabled={resolveMutation.isPending}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => resolveMutation.mutate('reject')}
          disabled={resolveMutation.isPending}
        >
          Reject
        </Button>
      </div>
    </div>
  )
}

function ConnectorNeededInboxAction({ item }: { item: InboxItem }) {
  const wsId = useWorkspaceId()
  const navigate = useNavigate()
  const invalidate = useInboxActionInvalidation(item.issue_id)
  const connectorId = item.details?.connector_id ?? ''
  const connectorLabel = item.details?.connector_label ?? connectorId
  const connector = getConnectorById(connectorId)
  const [awaiting, setAwaiting] = useState(false)
  const { data: connections } = useQuery({
    ...connectionListOptions(wsId),
    enabled: awaiting,
    refetchInterval: awaiting ? 1500 : false,
  })
  const connected = Boolean(
    connections?.integrations.some(
      (integration) =>
        Option.getOrNull(integration.gardenConnectorId) === connectorId &&
        integration.status === 'connected',
    ),
  )

  const resumeMutation = useMutation({
    mutationFn: async () => {
      if (!item.issue_id) return
      await api.startIssueRun(item.issue_id)
      await api.archiveInbox(item.id)
    },
    onSuccess: invalidate,
    onError: () => toast.error('Failed to resume issue'),
  })

  const dismissMutation = useMutation({
    mutationFn: () => api.archiveInbox(item.id),
    onSuccess: invalidate,
    onError: () => toast.error('Failed to dismiss'),
  })

  const connect = () => {
    if (!connector) return
    if (!connector.executorSlug) {
      navigate({ to: '/connectors' })
      return
    }
    const popup = window.open(
      executorOAuthStartUrl(connector.executorSlug, 'user'),
      'connector-oauth',
      'popup=yes,width=620,height=760',
    )
    if (!popup) {
      toast.error('Allow popups to connect this connector')
      return
    }
    setAwaiting(true)
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card px-3 py-3">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{connectorLabel}</p>
        <p className="whitespace-pre-wrap text-sm text-foreground">
          {item.body}
        </p>
      </div>
      {awaiting && !connected && (
        <p className="text-sm text-muted-foreground">
          Waiting for authorization...
        </p>
      )}
      <div className="flex items-center gap-2">
        {connected ? (
          <Button
            size="sm"
            onClick={() => resumeMutation.mutate()}
            disabled={resumeMutation.isPending}
          >
            Resume issue
          </Button>
        ) : (
          <Button size="sm" onClick={connect} disabled={!connector || awaiting}>
            Connect {connectorLabel}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => dismissMutation.mutate()}
          disabled={dismissMutation.isPending}
        >
          Dismiss
        </Button>
      </div>
    </div>
  )
}

function WorkProductInboxAction({
  workProduct,
  connectorId,
  reviewMutation,
}: {
  workProduct: IssueWorkProduct
  connectorId?: string | null
  reviewMutation: ReturnType<typeof useWorkProductReviewMutation>
}) {
  const review = (action: WorkProductReviewAction) =>
    reviewMutation.mutate({ id: workProduct.id, action })

  return (
    <WorkProductCard
      workProduct={workProduct}
      connectorId={connectorId}
      onApprove={() => review('approve')}
      onRequestChanges={() => review('request_changes')}
      onApply={() => review('apply')}
    />
  )
}

function QuestionInboxAction({
  item,
  question,
}: {
  item: InboxItem
  question: StructuredQuestion
}) {
  const invalidate = useInboxActionInvalidation(item.issue_id)
  const answerMutation = useMutation({
    mutationFn: (answer: string | string[]) => {
      const content = Array.isArray(answer) ? answer.join('\n') : answer
      return api.createComment(item.issue_id!, content)
    },
    onSuccess: invalidate,
    onError: () => toast.error('Failed to answer question'),
  })

  if (!item.issue_id) return null

  return (
    <QuestionCard
      question={question}
      agentName="Garden"
      onSubmit={(answer) => answerMutation.mutate(answer)}
      submitting={answerMutation.isPending}
      pulseOnMount
    />
  )
}

function ApprovalInboxAction({
  item,
  fallback,
}: {
  item: InboxItem
  fallback: { title: string; body: string; targetLabel?: string } | null
}) {
  const invalidate = useInboxActionInvalidation(item.issue_id)
  const requestId = item.details?.request_id ?? item.details?.approval_id
  const resolveMutation = useMutation({
    mutationFn: (approved: boolean) =>
      api.resolvePermissionRequest({ id: requestId!, approved }),
    onSuccess: invalidate,
    onError: () => toast.error('Failed to resolve approval'),
  })

  if (!requestId && !fallback) return null

  return (
    <ApprovalCard
      kind={item.details?.kind ?? 'connector_write'}
      title={fallback?.title ?? item.title}
      targetLabel={fallback?.targetLabel}
      body={<ConnectorWriteBody text={fallback?.body ?? item.body ?? ''} />}
      onApprove={() => requestId && resolveMutation.mutate(true)}
      onDeny={() => requestId && resolveMutation.mutate(false)}
      pending={resolveMutation.isPending}
      standalone
    />
  )
}

export function InboxControlPlane({ item }: { item: InboxItem }) {
  const wsId = useWorkspaceId()
  const issueId = item.issue_id
  const { data } = useQuery({
    ...issueActiveRunOptions(issueId ?? ''),
    enabled: Boolean(issueId),
  })
  const { data: issue } = useQuery({
    ...issueDetailOptions(wsId, issueId ?? ''),
    enabled: Boolean(issueId),
  })

  const { data: issueWorkProducts } = useQuery({
    ...issueWorkProductsOptions(issueId ?? ''),
    enabled: Boolean(issueId),
  })
  const events = data?.events ?? []
  const run = data?.run ?? null
  const workProducts = issueWorkProducts ?? []
  const question = useMemo(() => pendingQuestionFromEvents(events), [events])
  const approval = useMemo(() => pendingApprovalFromEvents(events), [events])
  const selectedWorkProduct = workProductForItem(item, workProducts)
  const connectorId = issue?.source_summary?.connector_id ?? null
  const reviewMutation = useWorkProductReviewMutation(issueId)
  const remainingWorkProducts = selectedWorkProduct
    ? workProducts.filter((wp) => wp.id !== selectedWorkProduct.id)
    : workProducts

  return (
    <div className="space-y-3">
      {item.type === 'waiting_for_input' && question && (
        <QuestionInboxAction item={item} question={question} />
      )}

      {item.type === 'review_requested' && (
        <ApprovalInboxAction item={item} fallback={approval} />
      )}

      {item.type === 'wp_review' && selectedWorkProduct && (
        <WorkProductInboxAction
          workProduct={selectedWorkProduct}
          connectorId={connectorId}
          reviewMutation={reviewMutation}
        />
      )}

      {item.type === 'brain_proposal' && (
        <BrainProposalInboxAction item={item} />
      )}

      {item.type === 'connector_needed' && (
        <ConnectorNeededInboxAction item={item} />
      )}

      {(item.type === 'task_failed' || item.type === 'agent_blocked') &&
        run && (
          <div className="rounded-lg border bg-card px-3 py-2">
            <LastRunSummary
              lastRun={{
                status: run.status,
                finished_at: run.finished_at,
                usage: run.usage ?? null,
              }}
            />
            {run.error && (
              <p className="mt-2 break-words font-mono text-xs text-destructive">
                {run.error}
              </p>
            )}
          </div>
        )}

      {remainingWorkProducts.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Work products
          </h3>
          <WorkProductList
            workProducts={remainingWorkProducts}
            connectorId={connectorId}
            onApprove={(id) => reviewMutation.mutate({ id, action: 'approve' })}
            onRequestChanges={(id) =>
              reviewMutation.mutate({ id, action: 'request_changes' })
            }
            onApply={(id) => reviewMutation.mutate({ id, action: 'apply' })}
          />
        </div>
      )}
    </div>
  )
}
