import { useQuery } from '@tanstack/react-query'
import { useWorkspaceId } from '@garden/app-state/hooks'
import type { TeamSummary, WorkspaceTeamSettings } from '@garden/core/types'
import { Label } from '@garden/ui/components/ui/label'
import { Switch } from '@garden/ui/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@garden/ui/components/ui/select'
import { toast } from 'sonner'
import { useUpdateWorkspaceTeamSettings } from '../mutations'
import { workspaceTeamSettingsOptions } from '../queries'

const NO_DEFAULT_TEAM = 'none'

/**
 * Workspace invite settings on the Teams overview, for owners and admins.
 * Before this, an accepted invite joined no Team, so new members landed on
 * an empty board. These two controls decide whether Team owners may invite
 * people into their Teams and which Team an invite joins when it names none.
 * The server enforces both; this only edits them.
 */
export function TeamInviteSettings({ teams }: { teams: TeamSummary[] }) {
  const wsId = useWorkspaceId()
  const { data: settings } = useQuery(workspaceTeamSettingsOptions(wsId))
  const update = useUpdateWorkspaceTeamSettings()

  const save = (patch: Partial<WorkspaceTeamSettings>) =>
    update.mutate(patch, {
      onError: (error) =>
        toast.error(
          error instanceof Error ? error.message : 'Failed to save setting',
        ),
    })

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl">Invites</h2>
      <div className="flex flex-col divide-y divide-border-default rounded-xl border-[0.5px] border-border-default bg-background-main-default">
        <div className="flex items-center justify-between gap-4 p-4">
          <div className="flex flex-col gap-0.5">
            <Label htmlFor="team-owners-can-invite">
              Team owners can invite people to their Team
            </Label>
            <p className="text-sm text-text-secondary">
              Owners and admins can always invite. Team owners join new people
              as members of the Teams they own.
            </p>
          </div>
          <Switch
            id="team-owners-can-invite"
            disabled={!settings}
            checked={settings?.team_owners_can_invite ?? false}
            onCheckedChange={(checked) =>
              save({ team_owners_can_invite: checked === true })
            }
          />
        </div>
        <div className="flex items-center justify-between gap-4 p-4">
          <div className="flex flex-col gap-0.5">
            <Label htmlFor="default-team">Default team for new members</Label>
            <p className="text-sm text-text-secondary">
              People invited without a Team join this one.
            </p>
          </div>
          <Select
            value={settings?.default_team_id ?? NO_DEFAULT_TEAM}
            disabled={!settings}
            onValueChange={(value) =>
              save({
                default_team_id:
                  value === NO_DEFAULT_TEAM ? null : (value as string),
              })
            }
          >
            <SelectTrigger id="default-team" size="sm" className="w-48">
              <SelectValue>
                {(value: string) =>
                  teams.find((team) => team.id === value)?.name ?? 'None'
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_DEFAULT_TEAM}>None</SelectItem>
              {teams.map((team) => (
                <SelectItem key={team.id} value={team.id}>
                  {team.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </section>
  )
}
