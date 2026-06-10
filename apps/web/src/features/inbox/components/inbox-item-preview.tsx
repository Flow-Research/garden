import {
  AlertOctagon,
  AtSign,
  CheckCircle2,
  FileText,
  GitPullRequest,
  ListChecks,
  MessageCircle,
  MessageCircleQuestion,
  MessageSquare,
  ShieldAlert,
  UserPlus,
  XCircle,
} from 'lucide-react'
import { cn } from '@garden/ui/lib/utils'
import type { InboxItem } from '@garden/core/types'
import { Markdown } from '@/features/common/markdown'

type Tone = 'default' | 'attention' | 'action' | 'success' | 'danger'

const TONE_STYLES: Record<
  Tone,
  { border: string; bg: string; chip: string; icon: string }
> = {
  default: {
    border: 'border-border',
    bg: 'bg-muted/40',
    chip: 'bg-muted text-muted-foreground',
    icon: 'text-muted-foreground',
  },
  attention: {
    border: 'border-amber-300/50 dark:border-amber-500/40',
    bg: 'bg-amber-50/60 dark:bg-amber-500/10',
    chip: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100',
    icon: 'text-amber-600 dark:text-amber-400',
  },
  action: {
    border: 'border-brand/40',
    bg: 'bg-brand/5',
    chip: 'bg-brand/10 text-brand',
    icon: 'text-brand',
  },
  success: {
    border: 'border-emerald-300/50 dark:border-emerald-500/40',
    bg: 'bg-emerald-50/60 dark:bg-emerald-500/10',
    chip: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-100',
    icon: 'text-emerald-600 dark:text-emerald-400',
  },
  danger: {
    border: 'border-rose-300/50 dark:border-rose-500/40',
    bg: 'bg-rose-50/60 dark:bg-rose-500/10',
    chip: 'bg-rose-100 text-rose-900 dark:bg-rose-500/20 dark:text-rose-100',
    icon: 'text-rose-600 dark:text-rose-400',
  },
}

const WORK_PRODUCT_ICON: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  brief: FileText,
  plan: ListChecks,
  connector_reply: MessageSquare,
  pull_request: GitPullRequest,
  report: FileText,
  checklist: ListChecks,
}

const WORK_PRODUCT_LABEL: Record<string, string> = {
  brief: 'Brief',
  plan: 'Plan',
  connector_reply: 'Connector reply',
  pull_request: 'Pull request',
  report: 'Report',
  checklist: 'Checklist',
}

type Preview = {
  tone: Tone
  Icon: React.ComponentType<{ className?: string }>
  label: string
  cta: string
  body: React.ReactNode
}

function bodyParagraph(body: string | null) {
  if (!body) return null
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm leading-relaxed text-foreground">
      <Markdown>{body}</Markdown>
    </div>
  )
}

function previewFor(item: InboxItem): Preview {
  const details = item.details ?? {}

  switch (item.type) {
    case 'waiting_for_input':
      return {
        tone: 'action',
        Icon: MessageCircleQuestion,
        label: 'Question waiting',
        cta: 'Open issue to answer',
        body:
          bodyParagraph(item.body) ??
          (
            <p className="text-sm text-muted-foreground">
              Garden paused on a question. Open the issue to read and reply.
            </p>
          ),
      }
    case 'wp_review': {
      const wpType = details.work_product_type ?? 'brief'
      const Icon = WORK_PRODUCT_ICON[wpType] ?? FileText
      const label = WORK_PRODUCT_LABEL[wpType] ?? 'Work product'
      return {
        tone: 'action',
        Icon,
        label: `${label} ready for review`,
        cta: 'Open to review',
        body:
          bodyParagraph(item.body) ??
          (
            <p className="text-sm text-muted-foreground">
              The draft is ready in the issue.
            </p>
          ),
      }
    }
    case 'review_requested':
      return {
        tone: 'action',
        Icon: ShieldAlert,
        label: 'Approval needed',
        cta: 'Open to approve',
        body:
          bodyParagraph(item.body) ??
          (
            <p className="text-sm text-muted-foreground">
              An action needs your approval before it can run.
            </p>
          ),
      }
    case 'agent_blocked':
      return {
        tone: 'danger',
        Icon: AlertOctagon,
        label: 'Blocked',
        cta: 'Open to unblock',
        body:
          bodyParagraph(item.body) ??
          (
            <p className="text-sm text-muted-foreground">
              Work paused. Garden needs a decision or a dependency cleared.
            </p>
          ),
      }
    case 'task_failed':
      return {
        tone: 'danger',
        Icon: XCircle,
        label: 'Run failed',
        cta: 'Open run',
        body:
          bodyParagraph(item.body) ??
          (
            <p className="text-sm text-muted-foreground">
              The run stopped without finishing. Check the timeline for the
              error.
            </p>
          ),
      }
    case 'issue_assigned':
    case 'assignee_changed':
      return {
        tone: 'action',
        Icon: UserPlus,
        label: 'Assigned to you',
        cta: 'Open issue',
        body:
          bodyParagraph(item.body) ??
          (
            <p className="text-sm text-muted-foreground">
              You picked up this issue. The agent is queued (or you've taken it
              on yourself).
            </p>
          ),
      }
    case 'mentioned':
      return {
        tone: 'attention',
        Icon: AtSign,
        label: 'You were mentioned',
        cta: 'Open thread',
        body:
          bodyParagraph(item.body) ??
          (
            <p className="text-sm text-muted-foreground">
              Someone mentioned you in a comment.
            </p>
          ),
      }
    case 'new_comment':
      return {
        tone: 'attention',
        Icon: MessageCircle,
        label: 'New comment',
        cta: 'Open thread',
        body:
          bodyParagraph(item.body) ??
          (
            <p className="text-sm text-muted-foreground">
              A new comment was added on an issue you're watching.
            </p>
          ),
      }
    case 'task_completed':
    case 'agent_completed':
      return {
        tone: 'success',
        Icon: CheckCircle2,
        label: 'Finished',
        cta: 'See result',
        body:
          bodyParagraph(item.body) ??
          (
            <p className="text-sm text-muted-foreground">
              Garden finished this run. Open the issue to review what was
              produced.
            </p>
          ),
      }
    default:
      return {
        tone: 'default',
        Icon: MessageSquare,
        label: 'Notification',
        cta: 'Open',
        body:
          bodyParagraph(item.body) ??
          (
            <p className="text-sm text-muted-foreground">{item.title}</p>
          ),
      }
  }
}

export function InboxItemPreviewCard({ item }: { item: InboxItem }) {
  const { tone, Icon, label, body } = previewFor(item)
  const styles = TONE_STYLES[tone]
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border',
        styles.border,
        styles.bg,
      )}
    >
      <div className="flex items-center gap-2 border-b border-inherit px-4 py-2.5">
        <Icon className={cn('h-4 w-4 shrink-0', styles.icon)} />
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide',
            styles.chip,
          )}
        >
          {label}
        </span>
      </div>
      <div className="p-4">{body}</div>
    </div>
  )
}

export function ctaForInboxItem(item: InboxItem): string {
  return previewFor(item).cta
}
