import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import type { Issue, UpdateIssueRequest } from '@garden/core/types'
import { formatCompactNumber, formatShortDate } from '@garden/core/format'
import { AppLink } from '../../navigation'
import { ActorAvatar } from '../../common/actor-avatar'
import { ProjectPicker } from '../../projects/components/project-picker'
import { issuePath } from '@/features/navigation/use-surface-navigation'
import type { useIssueDetailData } from '../hooks/use-issue-detail-data'
import {
  AssigneePicker,
  DueDatePicker,
  PriorityPicker,
  StatusPicker,
} from './pickers'
import { StatusIcon } from './status-icon'

type IssueDetailData = ReturnType<typeof useIssueDetailData>

export type IssueSidebarSection =
  | 'properties'
  | 'parentIssue'
  | 'details'
  | 'tokenUsage'

export const DEFAULT_SIDEBAR_SECTIONS: Record<IssueSidebarSection, boolean> = {
  properties: true,
  parentIssue: true,
  details: true,
  tokenUsage: true,
}

function shortDate(date: string | null): string {
  return date ? formatShortDate(date) : '—'
}

function PropRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-2 rounded-md px-2 -mx-2 hover:bg-accent/50 transition-colors">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs truncate">
        {children}
      </div>
    </div>
  )
}

/**
 * The issue properties rail: editable properties, parent issue, creation
 * details and (in debug mode) token usage. Section open/closed state is owned
 * by IssueDetail so it survives the desktop rail and mobile sheet swapping.
 */
export function IssueDetailSidebar({
  issue,
  parentIssue,
  usage,
  debugMode,
  getActorName,
  onUpdate,
  sections,
  onToggleSection,
}: {
  issue: Issue
  parentIssue: IssueDetailData['parentIssue']
  usage: IssueDetailData['usage']
  debugMode: boolean
  getActorName: IssueDetailData['getActorName']
  onUpdate: (updates: Partial<UpdateIssueRequest>) => void
  sections: Record<IssueSidebarSection, boolean>
  onToggleSection: (section: IssueSidebarSection) => void
}) {
  return (
    <div className="space-y-5">
      {/* Properties */}
      <div>
        <button
          className={`flex w-full items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors mb-2 hover:bg-accent/70 ${sections.properties ? '' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => onToggleSection('properties')}
        >
          Properties
          <ChevronRight
            className={`!size-3 shrink-0 stroke-[2.5] text-muted-foreground transition-transform ${sections.properties ? 'rotate-90' : ''}`}
          />
        </button>
        {sections.properties && (
          <div className="space-y-0.5 pl-2">
            <PropRow label="Status">
              <StatusPicker
                status={issue.status}
                onUpdate={onUpdate}
                align="start"
              />
            </PropRow>
            <PropRow label="Priority">
              <PriorityPicker
                priority={issue.priority}
                onUpdate={onUpdate}
                align="start"
              />
            </PropRow>
            <PropRow label="Assignee">
              <AssigneePicker
                assigneeType={issue.assignee_type}
                assigneeId={issue.assignee_id}
                onUpdate={onUpdate}
                align="start"
              />
            </PropRow>
            <PropRow label="Due date">
              <DueDatePicker dueDate={issue.due_date} onUpdate={onUpdate} />
            </PropRow>
            <PropRow label="Project">
              <ProjectPicker projectId={issue.project_id} onUpdate={onUpdate} />
            </PropRow>
          </div>
        )}
      </div>

      {/* Parent issue */}
      {parentIssue && (
        <div>
          <button
            className={`flex w-full items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors mb-2 hover:bg-accent/70 ${sections.parentIssue ? '' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => onToggleSection('parentIssue')}
          >
            Parent issue
            <ChevronRight
              className={`!size-3 shrink-0 stroke-[2.5] text-muted-foreground transition-transform ${sections.parentIssue ? 'rotate-90' : ''}`}
            />
          </button>
          {sections.parentIssue && (
            <div className="pl-2">
              <AppLink
                href={issuePath(parentIssue.id)}
                className="flex items-center gap-1.5 rounded-md px-2 py-1.5 -mx-2 text-xs hover:bg-accent/50 transition-colors group"
              >
                <StatusIcon
                  status={parentIssue.status}
                  className="h-3.5 w-3.5 shrink-0"
                />
                <span className="text-muted-foreground shrink-0">
                  {parentIssue.identifier}
                </span>
                <span className="truncate group-hover:text-foreground">
                  {parentIssue.title}
                </span>
              </AppLink>
            </div>
          )}
        </div>
      )}

      {/* Details */}
      <div>
        <button
          className={`flex w-full items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors mb-2 hover:bg-accent/70 ${sections.details ? '' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => onToggleSection('details')}
        >
          Details
          <ChevronRight
            className={`!size-3 shrink-0 stroke-[2.5] text-muted-foreground transition-transform ${sections.details ? 'rotate-90' : ''}`}
          />
        </button>
        {sections.details && (
          <div className="space-y-0.5 pl-2">
            <PropRow label="Created by">
              <ActorAvatar
                actorType={issue.creator_type}
                actorId={issue.creator_id}
                size={18}
              />
              <span className="truncate">
                {getActorName(issue.creator_type, issue.creator_id)}
              </span>
            </PropRow>
            <PropRow label="Created">
              <span className="text-muted-foreground">
                {shortDate(issue.created_at)}
              </span>
            </PropRow>
            <PropRow label="Updated">
              <span className="text-muted-foreground">
                {shortDate(issue.updated_at)}
              </span>
            </PropRow>
          </div>
        )}
      </div>

      {/* Token usage — debug-only. Users don't need to see input/output token
      breakdowns by default; engineers turn on debug in Settings. */}
      {debugMode && usage && usage.task_count > 0 && (
        <div>
          <button
            className={`flex w-full items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors mb-2 hover:bg-accent/70 ${sections.tokenUsage ? '' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => onToggleSection('tokenUsage')}
          >
            Token usage
            <ChevronRight
              className={`!size-3 shrink-0 stroke-[2.5] text-muted-foreground transition-transform ${sections.tokenUsage ? 'rotate-90' : ''}`}
            />
          </button>
          {sections.tokenUsage && (
            <div className="space-y-0.5 pl-2">
              <PropRow label="Input">
                <span className="text-muted-foreground">
                  {formatCompactNumber(usage.total_input_tokens)}
                </span>
              </PropRow>
              <PropRow label="Generated">
                <span className="text-muted-foreground">
                  {formatCompactNumber(usage.total_output_tokens)}
                </span>
              </PropRow>
              {(usage.total_cache_read_tokens > 0 ||
                usage.total_cache_write_tokens > 0) && (
                <PropRow label="Cache">
                  <span className="text-muted-foreground">
                    {formatCompactNumber(usage.total_cache_read_tokens)} read /{' '}
                    {formatCompactNumber(usage.total_cache_write_tokens)} write
                  </span>
                </PropRow>
              )}
              <PropRow label="Runs">
                <span className="text-muted-foreground">
                  {usage.task_count}
                </span>
              </PropRow>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
