'use client'

import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { StructuredQuestion } from '@garden/core/chat'
import type {
  InboxItem,
  IssueRunEvent,
  IssueWorkProduct,
} from '@garden/core/types'
import { api } from '@/lib/api'
import {
  issueActiveRunOptions,
  issueDetailOptions,
  issueKeys,
} from '@/lib/issues/queries'
import { inboxKeys } from '@/lib/inbox/queries'
import { useWorkspaceId } from '@garden/core/hooks'
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
    queryClient.invalidateQueries({ queryKey: inboxKeys.list(wsId) })
    queryClient.invalidateQueries({ queryKey: issueKeys.list(wsId) })
    if (issueId) {
      queryClient.invalidateQueries({ queryKey: issueKeys.activeRun(issueId) })
      queryClient.invalidateQueries({
        queryKey: issueKeys.detail(wsId, issueId),
      })
      queryClient.invalidateQueries({ queryKey: issueKeys.timeline(issueId) })
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

  const events = data?.events ?? []
  const run = data?.run ?? null
  const workProducts = data?.work_products ?? []
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
            onApprove={(id) =>
              reviewMutation.mutate({ id, action: 'approve' })
            }
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
