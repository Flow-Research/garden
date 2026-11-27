import {
  useId,
  useState,
  type ComponentType,
  type ReactNode,
  type SVGProps,
} from 'react'
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
import { connectorRegistry, type ConnectorId } from '@garden/connectors'
import type {
  TeamAgentArea,
  TeamAgentPolicy,
  TeamBlockableRiskClass,
  TeamRiskClass,
} from '@garden/core/teams/agent-policy'
import {
  GmailIcon,
  GoogleDriveIcon,
  SlackIcon,
} from '@garden/ui/components/icons'
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
import { BrandGithubIcon } from '@/components/icons/brand-github-icon'
import { connectionListOptions } from '@/lib/workspace/queries'
import { useUpdateTeamAgentPolicy } from '../mutations'
import { teamAgentPolicyOptions } from '../queries'

// https://github.com/simple-icons/simple-icons/blob/develop/icons/discord.svg
function DiscordLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <path
        fill="#5865F2"
        d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"
      />
    </svg>
  )
}

const CONNECTOR_CARDS = {
  discord: {
    Logo: DiscordLogo,
    summary: 'Read and send messages, start threads, and react.',
  },
  github: {
    Logo: BrandGithubIcon,
    summary:
      'Read and change code, manage issues and pull requests, and run workflows.',
  },
  gmail: {
    Logo: GmailIcon,
    summary: 'Read, draft, and label email. Send with Gmail API access.',
  },
  'google-drive': {
    Logo: GoogleDriveIcon,
    summary: 'Find, read, and create files.',
  },
  slack: {
    Logo: SlackIcon,
    summary: 'Read channels, draft and send messages, and create canvases.',
  },
} satisfies Record<
  ConnectorId,
  { Logo: ComponentType<SVGProps<SVGSVGElement>>; summary: string }
>

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

function ComingSoon({ className }: { className?: string }) {
  return (
    <Badge className={cn('font-normal', className)} variant="secondary">
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
      className="flex flex-col gap-3 border-b border-border-default py-4 first:pt-0 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
      data-disabled={disabled || undefined}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <span
          className={cn(
            'flex flex-wrap items-center gap-2 text-base',
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
        'flex min-h-10 max-w-full items-center gap-2.5 rounded-md border border-border-default px-3 py-1.5 text-sm text-foreground',
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
      <span>{label}</span>
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
        className="h-10! w-full shrink-0 gap-6 rounded-md bg-background px-3 text-sm sm:w-fit"
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
  'h-auto min-h-11 flex-auto shrink-0 gap-1.5 rounded-none px-2 py-1 text-sm font-normal text-text-secondary after:bg-text-brand-secondary focus-visible:ring-inset focus-visible:-outline-offset-2 group-data-[orientation=horizontal]/tabs:after:bottom-0 data-active:text-foreground lg:min-h-10 lg:gap-1 lg:px-1.5'

const TAB_PANEL_CLASS =
  'min-h-0 overflow-y-auto overscroll-contain pt-4 pb-4 lg:pt-8'

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
  const connectorDescriptionPrefix = useId()
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
      <SheetContent className="gap-0 bg-background data-[side=right]:h-dvh data-[side=right]:w-full data-[side=right]:sm:max-w-3xl lg:[&>[data-slot=sheet-close]]:top-6 lg:[&>[data-slot=sheet-close]]:right-6">
        <SheetHeader className="shrink-0 gap-2 px-4 pt-4 pb-4 sm:px-6 lg:gap-3 lg:px-8 lg:pt-11 lg:pb-8">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pr-9">
            <Settings
              aria-hidden
              className="size-6 shrink-0 text-text-secondary lg:size-7"
              strokeWidth={1.5}
            />
            <SheetTitle className="text-lg font-medium lg:text-xl">
              Team settings
            </SheetTitle>
            <Badge
              className="h-6 min-w-0 max-w-full rounded-md px-2 text-sm font-normal tracking-wide text-text-secondary uppercase"
              title={teamName}
              variant="secondary"
            >
              <span className="truncate">{teamName}</span>
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
          <Tabs
            className="min-h-0 flex-1 gap-0 px-4 sm:px-6 lg:px-8"
            defaultValue="agents"
          >
            <TabsList
              className="h-auto! w-full shrink-0 items-stretch justify-start gap-0 overflow-x-auto overscroll-x-contain border-b border-border-default bg-muted p-0"
              variant="line"
            >
              <TabsTrigger className={TAB_TRIGGER_CLASS} value="agents">
                <Database aria-hidden />
                Agent Permissions
              </TabsTrigger>
              <TabsTrigger className={TAB_TRIGGER_CLASS} disabled value="admin">
                <UserRoundCog aria-hidden />
                Admin Policy
                <ComingSoon className="h-4 px-1.5 text-[11px]" />
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

            <TabsContent className={TAB_PANEL_CLASS} value="agents">
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
                <div className="grid gap-2 sm:grid-cols-2">
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
              className={cn(TAB_PANEL_CLASS, 'flex flex-col gap-2')}
              value="connectors"
            >
              <p className="mb-2 text-sm text-text-secondary">
                Available actions depend on the connection&apos;s permissions
                and approval rules.
              </p>
              {connectorRegistry.map((connector) => {
                const integration = integrationFor(connector.id)
                const { Logo, summary } = CONNECTOR_CARDS[connector.id]
                const descriptionId = `${connectorDescriptionPrefix}-${connector.id}`
                return (
                  <div
                    className="flex items-center gap-3 rounded-lg bg-muted px-3 py-3 sm:gap-4 sm:px-6 sm:py-4"
                    key={connector.id}
                  >
                    <Logo
                      aria-hidden="true"
                      className="size-8 shrink-0 self-start text-foreground"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <span className="text-base text-foreground">
                        {connector.label}
                      </span>
                      <div id={descriptionId}>
                        <p className="text-sm text-text-secondary">{summary}</p>
                        <p className="mt-1 text-xs text-text-secondary">
                          {integration
                            ? statusLabelFor(integration.status)
                            : 'Not set up in this workspace'}
                        </p>
                      </div>
                    </div>
                    <Switch
                      aria-describedby={descriptionId}
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

            <TabsContent className={TAB_PANEL_CLASS} value="approvals">
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
          <div className="flex-1 px-4 text-sm text-text-secondary sm:px-6 lg:px-8">
            {query.isError
              ? 'Agent policy could not be loaded.'
              : 'Loading agent policy…'}
          </div>
        )}

        <SheetFooter className="grid shrink-0 grid-cols-2 gap-2 border-t border-border-default px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 lg:border-t-0 lg:px-8 lg:pt-6 lg:pb-14">
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
