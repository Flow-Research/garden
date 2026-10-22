import { Skeleton as BoneyardSkeleton } from 'boneyard-js/react'
import { ChevronRight } from 'lucide-react'

export const ISSUE_DETAIL_PAGE_SKELETON = 'issue-detail-page'
export const ISSUE_DETAIL_REACTIONS_SKELETON = 'issue-detail-reactions'
export const ISSUE_DETAIL_SUBSCRIBERS_SKELETON = 'issue-detail-subscribers'
export const ISSUE_DETAIL_TIMELINE_SKELETON = 'issue-detail-timeline'

function IssueDetailPageFixture() {
  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <span className="text-sm text-muted-foreground">Issues</span>
        <ChevronRight className="h-3 w-3 text-muted-foreground" />
        <span className="text-sm font-medium">GDN-14</span>
      </div>
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 space-y-6 p-8">
          <div className="space-y-3">
            <h1 className="text-2xl font-semibold text-foreground">
              Ship boneyard skeletons across the app
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Replace the hand-built placeholder system with colocated fixtures
              captured from the real layout.
            </p>
          </div>
          <div className="space-y-3 rounded-lg border border-border/70 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              Description
            </p>
            <p className="text-sm text-foreground">
              Keep the skeleton order with the UI file, then generate bones from
              a dedicated fixture route.
            </p>
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">
                Activity
              </span>
              <span className="text-xs text-muted-foreground">4 updates</span>
            </div>
            <IssueDetailTimelineFixture />
          </div>
        </div>
        <div className="w-64 border-l p-4">
          <div className="space-y-4">
            {[
              ['Status', 'In Progress'],
              ['Priority', 'High'],
              ['Assignee', 'Garden Agent'],
              ['Project', 'MVP'],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-3"
              >
                <span className="text-xs text-muted-foreground">{label}</span>
                <span className="text-xs font-medium text-foreground">
                  {value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function IssueDetailReactionsFixture() {
  return (
    <div className="flex items-center gap-1">
      {['👍 4', '👀 2'].map((reaction) => (
        <div
          key={reaction}
          className="inline-flex h-7 items-center rounded-full border border-border bg-accent px-3 text-xs text-foreground"
        >
          {reaction}
        </div>
      ))}
    </div>
  )
}

function IssueDetailSubscribersFixture() {
  return (
    <div className="flex items-center gap-2">
      <button className="text-xs text-muted-foreground">Unsubscribe</button>
      <div className="flex -space-x-1">
        {['A', 'M'].map((label) => (
          <div
            key={label}
            className="flex h-6 w-6 items-center justify-center rounded-full border bg-accent text-[10px] font-medium text-foreground"
          >
            {label}
          </div>
        ))}
      </div>
    </div>
  )
}

function IssueDetailTimelineFixture() {
  return (
    <div className="space-y-4">
      {[
        ['KG', 'Updated the rollout plan and capture route.'],
        ['AG', 'Connected boneyard to the web app runtime.'],
        ['KG', 'Queued the remaining page swaps.'],
      ].map(([actor, body]) => (
        <div key={body} className="flex items-start gap-3 px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xs font-medium text-foreground">
            {actor}
          </div>
          <div className="flex-1 rounded-lg border border-border/70 bg-card px-3 py-3">
            <p className="text-sm font-medium text-foreground">{actor}</p>
            <p className="mt-1 text-sm text-muted-foreground">{body}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

export function IssueDetailPageSkeleton() {
  const fixture = <IssueDetailPageFixture />

  return (
    <BoneyardSkeleton
      name={ISSUE_DETAIL_PAGE_SKELETON}
      loading
      fixture={fixture}
      className="flex flex-1 min-h-0"
    >
      {fixture}
    </BoneyardSkeleton>
  )
}

export function IssueDetailReactionsSkeleton() {
  const fixture = <IssueDetailReactionsFixture />

  return (
    <BoneyardSkeleton
      name={ISSUE_DETAIL_REACTIONS_SKELETON}
      loading
      fixture={fixture}
      className="inline-flex"
    >
      {fixture}
    </BoneyardSkeleton>
  )
}

export function IssueDetailSubscribersSkeleton() {
  const fixture = <IssueDetailSubscribersFixture />

  return (
    <BoneyardSkeleton
      name={ISSUE_DETAIL_SUBSCRIBERS_SKELETON}
      loading
      fixture={fixture}
      className="inline-flex"
    >
      {fixture}
    </BoneyardSkeleton>
  )
}

export function IssueDetailTimelineSkeleton() {
  const fixture = <IssueDetailTimelineFixture />

  return (
    <BoneyardSkeleton
      name={ISSUE_DETAIL_TIMELINE_SKELETON}
      loading
      fixture={fixture}
      className="w-full"
    >
      {fixture}
    </BoneyardSkeleton>
  )
}
