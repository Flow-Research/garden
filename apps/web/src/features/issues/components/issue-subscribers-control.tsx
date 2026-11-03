import { Users } from 'lucide-react'
import { AvatarGroup, AvatarGroupCount } from '@garden/ui/components/ui/avatar'
import { Checkbox } from '@garden/ui/components/ui/checkbox'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@garden/ui/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@garden/ui/components/ui/popover'
import { ActorAvatar } from '../../common/actor-avatar'
import type { useIssueDetailData } from '../hooks/use-issue-detail-data'

type IssueDetailData = ReturnType<typeof useIssueDetailData>
type SubscriberState = IssueDetailData['subscriberState']

/**
 * Human label for why a participant is on the issue. Surfaced in the
 * participants popover so a tagged agent reads as "joined via mention" rather
 * than an opaque checkbox — ties the @mention → join model to the UI. Reasons
 * come from the issue_subscriber table (@garden/db/subscribers).
 */
const SUBSCRIBER_REASON_LABEL: Record<string, string> = {
  creator: 'Creator',
  assignee: 'Assignee',
  commenter: 'Commented',
  mentioned: 'Mentioned',
  manual: 'Added',
}

function subscriberReasonLabel(reason: string | undefined): string | null {
  if (!reason) return null
  return SUBSCRIBER_REASON_LABEL[reason] ?? null
}

/** Subscribe toggle plus the participants popover for adding/removing people. */
export function IssueSubscribersControl({
  subscribers,
  isSubscribed,
  onToggleSubscribe,
  onToggleSubscriber,
  members,
  agents,
}: {
  subscribers: SubscriberState['subscribers']
  isSubscribed: SubscriberState['isSubscribed']
  onToggleSubscribe: SubscriberState['toggleSubscribe']
  onToggleSubscriber: SubscriberState['toggleSubscriber']
  members: IssueDetailData['members']
  agents: IssueDetailData['agents']
}) {
  return (
    <>
      <button
        onClick={onToggleSubscribe}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {isSubscribed ? 'Unsubscribe' : 'Subscribe'}
      </button>
      <Popover>
        <PopoverTrigger className="cursor-pointer hover:opacity-80 transition-opacity">
          {subscribers.length > 0 ? (
            <AvatarGroup>
              {subscribers.slice(0, 4).map((sub) => (
                <ActorAvatar
                  key={`${sub.user_type}-${sub.user_id}`}
                  actorType={sub.user_type}
                  actorId={sub.user_id}
                  size={24}
                />
              ))}
              {subscribers.length > 4 && (
                <AvatarGroupCount>+{subscribers.length - 4}</AvatarGroupCount>
              )}
            </AvatarGroup>
          ) : (
            <span className="flex items-center justify-center size-6 rounded-full border border-dashed border-muted-foreground/30 text-muted-foreground">
              <Users className="size-3" />
            </span>
          )}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-0">
          <Command>
            <CommandInput placeholder="Change subscribers..." />
            <CommandList className="max-h-64">
              <CommandEmpty>No results found</CommandEmpty>
              {members.length > 0 && (
                <CommandGroup heading="Members">
                  {members
                    .filter(
                      (m, i, arr) =>
                        arr.findIndex((x) => x.user_id === m.user_id) === i,
                    )
                    .map((m) => {
                      const sub = subscribers.find(
                        (s) =>
                          s.user_type === 'member' && s.user_id === m.user_id,
                      )
                      const isSubbed = !!sub
                      return (
                        <CommandItem
                          key={`member-${m.user_id}`}
                          onSelect={() =>
                            onToggleSubscriber(m.user_id, 'member', isSubbed)
                          }
                          className="flex items-center gap-2.5"
                        >
                          <Checkbox
                            checked={isSubbed}
                            className="pointer-events-none"
                          />
                          <ActorAvatar
                            actorType="member"
                            actorId={m.user_id}
                            size={22}
                          />
                          <span className="truncate flex-1">{m.name}</span>
                          {isSubbed && subscriberReasonLabel(sub?.reason) && (
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {subscriberReasonLabel(sub?.reason)}
                            </span>
                          )}
                        </CommandItem>
                      )
                    })}
                </CommandGroup>
              )}
              {agents.filter((a) => !a.archived_at).length > 0 && (
                <CommandGroup heading="Agents">
                  {agents
                    .filter((a) => !a.archived_at)
                    .map((a) => {
                      const sub = subscribers.find(
                        (s) => s.user_type === 'agent' && s.user_id === a.id,
                      )
                      const isSubbed = !!sub
                      return (
                        <CommandItem
                          key={`agent-${a.id}`}
                          onSelect={() =>
                            onToggleSubscriber(a.id, 'agent', isSubbed)
                          }
                          className="flex items-center gap-2.5"
                        >
                          <Checkbox
                            checked={isSubbed}
                            className="pointer-events-none"
                          />
                          <ActorAvatar
                            actorType="agent"
                            actorId={a.id}
                            size={22}
                          />
                          <span className="truncate flex-1">{a.name}</span>
                          {isSubbed && subscriberReasonLabel(sub?.reason) && (
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {subscriberReasonLabel(sub?.reason)}
                            </span>
                          )}
                        </CommandItem>
                      )
                    })}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </>
  )
}
