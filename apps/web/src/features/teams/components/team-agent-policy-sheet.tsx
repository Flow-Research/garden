import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Option } from 'effect'
import {
  CheckCheck,
  Database,
  Plug,
  Settings,
  UserRoundCog,
} from 'lucide-react'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { connectorRegistry } from '@garden/connectors'
import type {
  TeamAgentArea,
  TeamAgentPolicy,
  TeamBlockableRiskClass,
  TeamRiskClass,
} from '@garden/core/teams/agent-policy'
import { Badge } from '@garden/ui/components/ui/badge'
import { Button } from '@garden/ui/components/ui/button'
import { Checkbox } from '@garden/ui/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@garden/ui/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@garden/ui/components/ui/sheet'
import { Switch } from '@garden/ui/components/ui/switch'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@garden/ui/components/ui/tabs'
import { cn } from '@garden/ui/lib/utils'
import { toast } from 'sonner'
import { statusLabelFor } from '@/features/connections/components/connection-helpers'
import { ProviderIcon } from '@/features/connections/components/provider-icon'
import { connectionListOptions } from '@/lib/workspace/queries'
import { useUpdateTeamAgentPolicy } from '../mutations'
import { teamAgentPolicyOptions } from '../queries'

/** One Access chip. `area: null` is a design area Garden cannot back. */
const ACCESS_CHIPS: readonly { area: TeamAgentArea | null; label: string }[] = [
  { area: null, label: 'Chats' },
  { area: 'tasks', label: 'Tasks' },
  { area: 'knowledge', label: 'Knowledge' },
  { area: 'inbox', label: 'Inbox' },
  { area: 'connections', label: 'Connections' },
  { area: 'workflows', label: 'Workflows' },
  { area: 'skills', label: 'Skills' },
  { area: null, label: 'Home' },
]

/** One Restricted card. `riskClass: null` has no Garden capability yet. */
const RESTRICTED_CARDS: readonly {
  riskClass: TeamBlockableRiskClass | null
  label: string
}[] = [
  { riskClass: 'destructive', label: 'Destructive actions' },
  { riskClass: 'send_external', label: 'Sending outside the workspace' },
  { riskClass: null, label: 'Delete projects' },
  { riskClass: null, label: 'Manage billing' },
  { riskClass: null, label: 'Read locked files' },
]

const APPROVAL_ROWS: readonly {
  riskClass: TeamRiskClass
  label: string
  hint: string
}[] = [
  {
    riskClass: 'write',
    label: 'Write changes',
    hint: 'Creating or editing anything in the workspace',
  },
  {
    riskClass: 'send_external',
    label: 'Sending outside the workspace',
    hint: 'Emails, messages, and posts to other services',
  },
  {
    riskClass: 'destructive',
    label: 'Destructive actions',
    hint: 'Deleting or overwriting data',
  },
]

const APPROVAL_LABELS = {
  required: 'Approval required',
  agent: 'Follow agent settings',
} as const

function ComingSoon() {
  return (
    <Badge className="font-normal" variant="secondary">
      Coming soon
    </Badge>
  )
}

/** A labelled settings row: label and hint left, control right, divider below. */
function PolicyRow({
  label,
  hint,
  control,
  disabled = false,
}: {
  label: string
  hint: string
  control: ReactNode
  disabled?: boolean
}) {
  return (
    <div
      className="flex items-center justify-between gap-6 border-b border-border-default py-4 first:pt-0 last:border-b-0"
      data-disabled={disabled || undefined}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <span
          className={cn(
            'flex items-center gap-2 text-base',
            disabled ? 'text-text-secondary' : 'text-foreground',
          )}
        >
          {label}
          {disabled ? <ComingSoon /> : null}
        </span>
        <span className="text-sm text-text-secondary">{hint}</span>
      </div>
      {control}
    </div>
  )
}

/** A section heading with its hint, as in the Access and Restricted blocks. */
function SectionHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-base font-normal text-foreground">{title}</h3>
      <p className="text-sm text-text-secondary">{hint}</p>
    </div>
  )
}

/**
 * A bordered checkbox tile used for both Access chips and Restricted cards.
 * Unbacked design options pass `checked: null` and render disabled with a
 * Coming soon badge so they can never reach the draft. Base UI names the
 * checkbox from the wrapping label, so the badge is hidden from that name.
 */
function CheckTile({
  label,
  checked,
  locked,
  onChange,
  className,
}: {
  label: string
  checked: boolean | null
  locked: boolean
  onChange: (checked: boolean) => void
  className?: string
}) {
  const soon = checked === null
  return (
    <label
      className={cn(
        'flex h-10 items-center gap-2.5 rounded-md border border-border-default px-3 text-sm whitespace-nowrap text-foreground',
        soon || locked ? 'cursor-not-allowed' : 'cursor-pointer',
        soon && 'text-text-secondary',
        className,
      )}
    >
      <Checkbox
        checked={checked ?? false}
        disabled={soon || locked}
        onCheckedChange={onChange}
      />
      <span className="truncate">{label}</span>
      {soon ? (
        <span aria-hidden className="contents">
          <ComingSoon />
        </span>
      ) : null}
    </label>
  )
}

/** Bordered select matching the design's right-aligned row control. */
function RowSelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string
  value: string
  options: readonly { value: string; label: string }[]
  disabled: boolean
  onChange?: (value: string) => void
}) {
  return (
    <Select
      disabled={disabled}
      onValueChange={(next) => onChange?.(String(next))}
      value={value}
    >
      <SelectTrigger
        aria-label={label}
        className="h-10! shrink-0 gap-6 rounded-md bg-background px-3 text-sm"
      >
        <SelectValue>
          {(current: string) =>
            options.find((option) => option.value === current)?.label ?? current
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Adds or removes `value` from a list, keeping the list free of repeats. */
function toggle<T>(list: readonly T[], value: T, present: boolean): T[] {
  const without = list.filter((entry) => entry !== value)
  return present ? [...without, value] : without
}

const TAB_TRIGGER_CLASS =
  'h-10 flex-1 gap-2 rounded-none px-3 text-sm font-normal text-text-secondary after:bg-text-brand-secondary data-active:text-foreground'

/**
 * Team agent policy side sheet ("Team settings"), opened from the Team detail
 * actions menu. Workspace managers edit; the Team owner reads it. Edits stay
 * in a local draft until Save Changes, which writes optimistically through
 * TanStack Query and rolls back on failure. Design controls Garden cannot
 * back render disabled with a Coming soon badge and never reach the draft.
 *
 * Before: the tab strip rendered as a full-height column and the panels were
 * invisible, because the shared Tabs primitive keyed its layout on
 * `data-horizontal`, an attribute Base UI never sets (it sets
 * `data-orientation`). After: the primitive matches `data-orientation`, and
 * this sheet follows the admin design frames 34-37 (771px panel, underline
 * tabs on a muted strip, label/hint rows, checkbox tiles, connector cards,
 * full-width footer). Copy decisions: docs/archive/specs/2026-11-team-agent-policy.md.
 */
export function TeamAgentPolicySheet({
  teamId,
  teamName,
  open,
  onOpenChange,
}: {
  teamId: string
  teamName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const wsId = useWorkspaceId()
  const query = useQuery({
    ...teamAgentPolicyOptions(wsId, teamId),
    enabled: open,
  })
  const connections = useQuery({
    ...connectionListOptions(wsId),
    enabled: open,
  })
  const save = useUpdateTeamAgentPolicy(teamId)
  const [draft, setDraft] = useState<TeamAgentPolicy | null>(null)

  const close = () => {
    setDraft(null)
    onOpenChange(false)
  }
  const saved = query.data?.policy
  const policy = draft ?? saved
  const canEdit = query.data?.can_edit ?? false
  const locked = !canEdit || save.isPending
  const update = (next: (current: TeamAgentPolicy) => TeamAgentPolicy) => {
    if (policy) setDraft(next(policy))
  }
  const integrationFor = (connectorId: string) =>
    connections.data?.integrations.find(
      (integration) =>
        Option.getOrUndefined(integration.gardenConnectorId) === connectorId,
    )

  const handleSave = () => {
    if (!draft) return
    save.mutate(draft, {
      onSuccess: () => {
        toast.success('Agent policy saved')
        close()
      },
      onError: () => toast.error('Failed to save agent policy'),
    })
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <SheetContent className="w-full gap-0 bg-background data-[side=right]:sm:max-w-3xl [&>[data-slot=sheet-close]]:top-6 [&>[data-slot=sheet-close]]:right-6">
        <SheetHeader className="gap-2 px-8 pt-10 pb-8">
          <div className="flex items-center gap-3">
            <Settings
              aria-hidden
              className="size-7 text-text-secondary"
              strokeWidth={1.5}
            />
            <SheetTitle className="text-2xl font-medium">
              Team settings
            </SheetTitle>
            <Badge
              className="h-6 rounded-md px-2 text-sm font-normal tracking-wide text-text-secondary uppercase"
              variant="secondary"
            >
              {teamName}
            </Badge>
          </div>
          <SheetDescription className="text-sm text-text-secondary">
            Define what agents can do when they act for this Team&apos;s
            members.
          </SheetDescription>
          {query.data && !canEdit ? (
            <p className="text-sm text-text-secondary" role="note">
              Only workspace owners and admins can change this policy.
            </p>
          ) : null}
        </SheetHeader>

        {policy ? (
          <Tabs className="min-h-0 flex-1 gap-0 px-8" defaultValue="agents">
            <TabsList
              className="h-10! w-full gap-0 border-b border-border-default bg-muted p-0"
              variant="line"
            >
              <TabsTrigger className={TAB_TRIGGER_CLASS} value="agents">
                <Database aria-hidden />
                Agent Permissions
              </TabsTrigger>
              <TabsTrigger className={TAB_TRIGGER_CLASS} disabled value="admin">
                <UserRoundCog aria-hidden />
                Admin Policy
                <ComingSoon />
              </TabsTrigger>
              <TabsTrigger className={TAB_TRIGGER_CLASS} value="connectors">
                <Plug aria-hidden />
                Connector Grants
              </TabsTrigger>
              <TabsTrigger className={TAB_TRIGGER_CLASS} value="approvals">
                <CheckCheck aria-hidden />
                Task Approval Rules
              </TabsTrigger>
            </TabsList>

            <TabsContent className="overflow-y-auto pt-8 pb-4" value="agents">
              <PolicyRow
                control={
                  <RowSelect
                    disabled
                    label="Team Role"
                    options={[{ value: 'member', label: 'Member' }]}
                    value="member"
                  />
                }
                disabled
                hint="Choose the exact role for the team"
                label="Team Role"
              />
              <div className="flex flex-col gap-6 border-b border-border-default py-4">
                <SectionHeading
                  hint="Select the areas agents can use for this Team"
                  title="Access"
                />
                <div className="flex flex-wrap gap-2">
                  {ACCESS_CHIPS.map(({ area, label }) => (
                    <CheckTile
                      checked={
                        area === null
                          ? null
                          : policy.allowed_areas.includes(area)
                      }
                      key={label}
                      label={label}
                      locked={locked}
                      onChange={(checked) =>
                        area &&
                        update((current) => ({
                          ...current,
                          allowed_areas: toggle(
                            current.allowed_areas,
                            area,
                            checked,
                          ),
                        }))
                      }
                    />
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-6 py-4">
                <SectionHeading
                  hint="Define what agents are restricted from doing"
                  title="Restricted"
                />
                <div className="grid grid-cols-3 gap-2">
                  {RESTRICTED_CARDS.map(({ riskClass, label }) => (
                    <CheckTile
                      checked={
                        riskClass === null
                          ? null
                          : policy.blocked_risk_classes.includes(riskClass)
                      }
                      key={label}
                      label={label}
                      locked={locked}
                      onChange={(checked) =>
                        riskClass &&
                        update((current) => ({
                          ...current,
                          blocked_risk_classes: toggle(
                            current.blocked_risk_classes,
                            riskClass,
                            checked,
                          ),
                        }))
                      }
                    />
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent
              className="flex flex-col gap-2 overflow-y-auto pt-8 pb-4"
              value="connectors"
            >
              {connectorRegistry.map((connector) => {
                const integration = integrationFor(connector.id)
                return (
                  <div
                    className="flex items-center gap-4 rounded-lg bg-muted px-6 py-4"
                    key={connector.id}
                  >
                    <ProviderIcon
                      className="size-8 shrink-0 object-contain text-text-secondary"
                      icon={integration?.icon ?? Option.none()}
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <span className="text-base text-foreground">
                        {connector.label}
                      </span>
                      <span className="text-sm text-text-secondary">
                        {integration
                          ? statusLabelFor(integration.status)
                          : 'Not set up in this workspace'}
                      </span>
                    </div>
                    <Switch
                      aria-label={connector.label}
                      checked={
                        !policy.blocked_connector_ids.includes(connector.id)
                      }
                      className="data-[size=default]:h-6 data-[size=default]:w-10 [&>span]:group-data-[size=default]/switch:size-5"
                      disabled={locked}
                      onCheckedChange={(checked) =>
                        update((current) => ({
                          ...current,
                          blocked_connector_ids: toggle(
                            current.blocked_connector_ids,
                            connector.id,
                            !checked,
                          ),
                        }))
                      }
                    />
                  </div>
                )
              })}
            </TabsContent>

            <TabsContent
              className="overflow-y-auto pt-8 pb-4"
              value="approvals"
            >
              {APPROVAL_ROWS.map((row) => (
                <PolicyRow
                  control={
                    <RowSelect
                      disabled={locked}
                      label={row.label}
                      onChange={(value) =>
                        update((current) => ({
                          ...current,
                          approval_required: toggle(
                            current.approval_required,
                            row.riskClass,
                            value === 'required',
                          ),
                        }))
                      }
                      options={[
                        { value: 'required', label: APPROVAL_LABELS.required },
                        { value: 'agent', label: APPROVAL_LABELS.agent },
                      ]}
                      value={
                        policy.approval_required.includes(row.riskClass)
                          ? 'required'
                          : 'agent'
                      }
                    />
                  }
                  hint={row.hint}
                  key={row.riskClass}
                  label={row.label}
                />
              ))}
              {['Deploy changes', 'Create documents'].map((label) => (
                <PolicyRow
                  control={
                    <RowSelect
                      disabled
                      label={label}
                      options={[
                        { value: 'agent', label: APPROVAL_LABELS.agent },
                      ]}
                      value="agent"
                    />
                  }
                  disabled
                  hint="No matching action in Garden yet"
                  key={label}
                  label={label}
                />
              ))}
              <PolicyRow
                control={
                  <RowSelect
                    disabled
                    label="Default Approver"
                    options={[{ value: 'owner', label: 'Team owner' }]}
                    value="owner"
                  />
                }
                hint="Workspace admins can also approve"
                label="Default Approver"
              />
            </TabsContent>
          </Tabs>
        ) : (
          <div className="flex-1 px-8 text-sm text-text-secondary">
            {query.isError
              ? 'Agent policy could not be loaded.'
              : 'Loading agent policy…'}
          </div>
        )}

        <SheetFooter className="grid grid-cols-2 gap-2 px-8 pt-6 pb-14">
          <Button className="h-10" onClick={close} variant="outline">
            Cancel
          </Button>
          <Button
            className="h-10"
            disabled={!canEdit || !draft || save.isPending}
            onClick={handleSave}
          >
            {save.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
