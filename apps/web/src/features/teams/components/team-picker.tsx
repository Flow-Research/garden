import { useState } from 'react'
import { Users } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useWorkspaceId } from '@garden/app-state/hooks'
import {
  PickerEmpty,
  PickerItem,
  PropertyPicker,
} from '../../issues/components/pickers/property-picker'
import { teamListOptions } from '../queries'
import { teamColor } from './team-tokens'

/**
 * Selects the Team for a cross-team create (Teams › Tasks "New Issue" while
 * the All filter is active). Mirrors the ProjectPicker shell; the Team is
 * required by the caller in that mode, so there is no clear option.
 */
export function TeamPicker({
  teamId,
  onUpdate,
  triggerRender,
  align = 'start',
}: {
  teamId: string | null
  onUpdate: (teamId: string) => void
  triggerRender?: React.ReactElement
  align?: 'start' | 'center' | 'end'
}) {
  const [open, setOpen] = useState(false)
  const workspaceId = useWorkspaceId()
  const { data: teams = [] } = useQuery(teamListOptions(workspaceId))
  const current = teams.find((team) => team.id === teamId)

  const choose = (nextTeamId: string) => {
    onUpdate(nextTeamId)
    setOpen(false)
  }

  return (
    <PropertyPicker
      open={open}
      onOpenChange={setOpen}
      align={align}
      width="w-52"
      triggerRender={triggerRender}
      trigger={
        <>
          <Users className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{current?.name ?? 'Select Team'}</span>
        </>
      }
    >
      {teams.map((team) => (
        <PickerItem
          key={team.id}
          selected={team.id === teamId}
          onClick={() => choose(team.id)}
        >
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ background: teamColor(team.id) }}
          />
          <span className="truncate">{team.name}</span>
        </PickerItem>
      ))}
      {!teams.length ? <PickerEmpty /> : null}
    </PropertyPicker>
  )
}
