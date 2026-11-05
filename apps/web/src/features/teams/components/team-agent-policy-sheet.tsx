import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
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
import { toast } from 'sonner'
import { useUpdateTeamAgentPolicy } from '../mutations'
import { teamAgentPolicyOptions } from '../queries'

const AREAS: readonly { value: TeamAgentArea; label: string; hint: string }[] =
  [
    { value: 'tasks', label: 'Tasks', hint: 'Create, read, and update issues' },
    { value: 'knowledge', label: 'Knowledge', hint: 'Search and add to Brain' },
    { value: 'inbox', label: 'Inbox', hint: 'Inbox tools' },
    {
      value: 'connections',
      label: 'Connections',
      hint: 'Connector tools, including Executor',
    },
    { value: 'workflows', label: 'Workflows', hint: 'Automation tools' },
    { value: 'skills', label: 'Skills', hint: 'Activate and run skills' },
  ]

const RESTRICTIONS: readonly {
  value: TeamBlockableRiskClass
  label: string
}[] = [
  { value: 'destructive', label: 'Destructive actions' },
  { value: 'send_external', label: 'Sending outside the workspace' },
]

const APPROVAL_CLASSES: readonly { value: TeamRiskClass; label: string }[] = [
  { value: 'write', label: 'Write' },
  { value: 'send_external', label: 'Sending outside the workspace' },
  { value: 'destructive', label: 'Destructive' },
]

function ComingSoon() {
  return <Badge variant="secondary">Coming soon</Badge>
}

/** One labelled row with its control on the right. */
function PolicyRow({
  label,
  hint,
  control,
  disabled = false,
}: {
  label: string
  hint?: string
  control: ReactNode
  disabled?: boolean
}) {
  return (
    <div
      className="flex items-center justify-between gap-4 py-3"
      data-disabled={disabled || undefined}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span
          className={
            disabled
              ? 'text-sm text-text-secondary'
              : 'text-sm font-medium text-foreground'
          }
        >
          {label}
        </span>
        {hint ? (
          <span className="text-xs text-text-secondary">{hint}</span>
        ) : null}
      </div>
      {control}
    </div>
  )
}

/** A design control Garden cannot back yet: shown, disabled, stores nothing. */
function ComingSoonRow({ label }: { label: string }) {
  return (
    <PolicyRow
      disabled
      label={label}
      control={
        <span className="flex items-center gap-2">
          <ComingSoon />
          <Switch aria-label={label} checked={false} disabled />
        </span>
      }
    />
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      <h3 className="pb-1 text-xs font-medium tracking-wide text-text-secondary uppercase">
        {title}
      </h3>
      <div className="flex flex-col divide-y divide-border-default">
        {children}
      </div>
    </section>
  )
}

/** Two-option control for an approval row: agent settings or approval. */
function ApprovalChoice({
  label,
  required,
  disabled,
  onChange,
}: {
  label: string
  required: boolean
  disabled: boolean
  onChange: (required: boolean) => void
}) {
  const options = [
    { value: false, text: 'Follow agent settings' },
    { value: true, text: 'Approval required' },
  ]
  return (
    <div
      aria-label={label}
      className="inline-flex rounded-md border border-border-default p-0.5"
      role="radiogroup"
    >
      {options.map((option) => (
        <button
          aria-checked={required === option.value}
          className="rounded-[5px] px-2 py-1 text-xs text-text-secondary transition-colors aria-checked:bg-secondary aria-checked:font-medium aria-checked:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          key={option.text}
          onClick={() => onChange(option.value)}
          role="radio"
          type="button"
        >
          {option.text}
        </button>
      ))}
    </div>
  )
}

/** Adds or removes `value` from a list, keeping the list free of repeats. */
function toggle<T>(list: readonly T[], value: T, present: boolean): T[] {
  const without = list.filter((entry) => entry !== value)
  return present ? [...without, value] : without
}

/**
 * Team agent policy side sheet, opened from the Team detail overflow menu.
 * Workspace managers edit; the Team owner reads it. Edits stay in a local
 * draft until Save changes, which writes optimistically through TanStack
 * Query. Design controls Garden cannot back render disabled with a Coming
 * soon badge and never reach the draft. See docs/concepts/features/teams.md.
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
      <SheetContent className="w-full gap-0 data-[side=right]:sm:max-w-lg">
        <SheetHeader className="border-b border-border-default">
          <SheetTitle>Agent policy</SheetTitle>
          <SheetDescription>
            Limits for agents acting for members of {teamName}. A Team policy
            can only remove abilities and add approvals.
          </SheetDescription>
          {query.data && !canEdit ? (
            <p className="text-xs text-text-secondary" role="note">
              Only workspace owners and admins can change this policy.
            </p>
          ) : null}
        </SheetHeader>

        {policy ? (
          <Tabs className="min-h-0 flex-1 gap-4 p-4" defaultValue="agents">
            <TabsList>
              <TabsTrigger value="agents">Agent access</TabsTrigger>
              <TabsTrigger value="connectors">Connector access</TabsTrigger>
              <TabsTrigger value="approvals">Approval rules</TabsTrigger>
              <TabsTrigger disabled value="admin">
                Admin Policy
                <ComingSoon />
              </TabsTrigger>
            </TabsList>

            <TabsContent
              className="flex flex-col gap-6 overflow-y-auto"
              value="agents"
            >
              <Section title="Areas">
                {AREAS.map((area) => (
                  <PolicyRow
                    control={
                      <Switch
                        aria-label={area.label}
                        checked={policy.allowed_areas.includes(area.value)}
                        disabled={locked}
                        onCheckedChange={(checked) =>
                          update((current) => ({
                            ...current,
                            allowed_areas: toggle(
                              current.allowed_areas,
                              area.value,
                              checked,
                            ),
                          }))
                        }
                      />
                    }
                    hint={area.hint}
                    key={area.value}
                    label={area.label}
                  />
                ))}
                <ComingSoonRow label="Chats" />
                <ComingSoonRow label="Home" />
              </Section>

              <Section title="Restricted">
                {RESTRICTIONS.map((restriction) => (
                  <PolicyRow
                    control={
                      <Switch
                        aria-label={`Block ${restriction.label}`}
                        checked={policy.blocked_risk_classes.includes(
                          restriction.value,
                        )}
                        disabled={locked}
                        onCheckedChange={(checked) =>
                          update((current) => ({
                            ...current,
                            blocked_risk_classes: toggle(
                              current.blocked_risk_classes,
                              restriction.value,
                              checked,
                            ),
                          }))
                        }
                      />
                    }
                    key={restriction.value}
                    label={restriction.label}
                  />
                ))}
                <ComingSoonRow label="Delete projects" />
                <ComingSoonRow label="Manage billing" />
                <ComingSoonRow label="Read locked files" />
              </Section>

              <Section title="Members">
                <PolicyRow
                  control={
                    <span className="flex items-center gap-2">
                      <ComingSoon />
                      <Button disabled size="sm" variant="outline">
                        Team role
                      </Button>
                    </span>
                  }
                  disabled
                  hint="Per-member roles beyond the Team owner"
                  label="Team role"
                />
              </Section>
            </TabsContent>

            <TabsContent
              className="flex flex-col gap-6 overflow-y-auto"
              value="connectors"
            >
              <Section title="Connectors">
                {connectorRegistry.map((connector) => (
                  <PolicyRow
                    control={
                      <Switch
                        aria-label={connector.label}
                        checked={
                          !policy.blocked_connector_ids.includes(connector.id)
                        }
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
                    }
                    key={connector.id}
                    label={connector.label}
                  />
                ))}
              </Section>
            </TabsContent>

            <TabsContent
              className="flex flex-col gap-6 overflow-y-auto"
              value="approvals"
            >
              <Section title="Approval rules">
                {APPROVAL_CLASSES.map((riskClass) => (
                  <PolicyRow
                    control={
                      <ApprovalChoice
                        disabled={locked}
                        label={riskClass.label}
                        onChange={(required) =>
                          update((current) => ({
                            ...current,
                            approval_required: toggle(
                              current.approval_required,
                              riskClass.value,
                              required,
                            ),
                          }))
                        }
                        required={policy.approval_required.includes(
                          riskClass.value,
                        )}
                      />
                    }
                    key={riskClass.value}
                    label={riskClass.label}
                  />
                ))}
                <PolicyRow
                  control={<ComingSoon />}
                  disabled
                  label="Deploy changes"
                />
                <PolicyRow
                  control={<ComingSoon />}
                  disabled
                  label="Create documents"
                />
              </Section>
              <Section title="Approver">
                <PolicyRow
                  control={null}
                  label="The Team owner, or any workspace admin."
                />
              </Section>
            </TabsContent>
          </Tabs>
        ) : (
          <div className="flex-1 p-4 text-sm text-text-secondary">
            {query.isError
              ? 'Agent policy could not be loaded.'
              : 'Loading agent policy…'}
          </div>
        )}

        <SheetFooter className="flex-row justify-end border-t border-border-default">
          <Button onClick={close} variant="outline">
            Cancel
          </Button>
          <Button
            disabled={!canEdit || !draft || save.isPending}
            onClick={handleSave}
          >
            {save.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
