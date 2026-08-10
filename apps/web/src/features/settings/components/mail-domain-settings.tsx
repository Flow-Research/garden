// Directly adapts Cloudflare Agentic Inbox domain/list/form composition (Apache-2.0)
// inside Zero's settings section hierarchy (MIT). See THIRD_PARTY_NOTICES.md.

import { useState, type FormEvent } from 'react'
import { AlertCircle, Check, Globe2, Plus, RefreshCw } from 'lucide-react'
import { Alert, AlertDescription } from '@garden/ui/components/ui/alert'
import { Badge } from '@garden/ui/components/ui/badge'
import { Button } from '@garden/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@garden/ui/components/ui/dialog'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@garden/ui/components/ui/empty'
import { Input } from '@garden/ui/components/ui/input'
import type {
  ActiveMailSettingsController,
  MailDomainSettingsView,
  RegisterMailDomainSettingsInput,
} from '../mail-settings-controller'
import { MailSettingsCard } from './mail-settings-card'

const domainStatusLabels: Record<MailDomainSettingsView['status'], string> = {
  pending_verification: 'Pending verification',
  active: 'Active',
  suspended: 'Suspended',
  failed: 'Needs attention',
}

/**
 * Keeps managed-domain onboarding controlled at the form boundary.
 * Command failures remain visible in-place; successful commands close/reset only
 * after the controller confirms the domain was registered.
 */
function DomainForm({
  controller,
  formId,
  onCreated,
}: {
  controller: ActiveMailSettingsController
  formId: string
  onCreated?: () => void
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string>()
  const registering = controller.pendingAction?.kind === 'register_domain'

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(undefined)
    const input: RegisterMailDomainSettingsInput = {
      name: name.trim(),
    }
    const result = await controller.actions.registerDomain(input)
    result.match({
      ok: () => {
        setName('')
        onCreated?.()
      },
      err: (failure) => setError(failure.message),
    })
  }

  return (
    <form id={formId} onSubmit={submit} className="space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="space-y-1.5">
        <label htmlFor={`${formId}-name`} className="text-sm font-medium">
          Domain
        </label>
        <Input
          id={`${formId}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="example.com"
          autoComplete="off"
          required
          disabled={registering}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Garden finds the managed DNS zone, then configures sending and routing
        automatically.
      </p>
    </form>
  )
}

function DomainCapability({
  enabled,
  label,
}: {
  enabled: boolean
  label: string
}) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {enabled ? (
        <Check className="size-3.5 text-emerald-600" />
      ) : (
        <span className="size-2 rounded-full bg-muted-foreground/35" />
      )}
      {label}
    </span>
  )
}

/** Domain status row copied from Agentic Inbox's bordered home-list geometry. */
function DomainRow({
  domain,
  controller,
}: {
  domain: MailDomainSettingsView
  controller: ActiveMailSettingsController
}) {
  const [error, setError] = useState<string>()
  const refreshing =
    controller.pendingAction?.kind === 'refresh_domain' &&
    controller.pendingAction.domainId === domain.id

  const refresh = async () => {
    setError(undefined)
    const result = await controller.actions.refreshDomain(domain.id)
    result.match({
      ok: () => undefined,
      err: (failure) => setError(failure.message),
    })
  }

  return (
    <li className="px-5 py-4 [&+&]:border-t">
      <div className="flex items-start gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
          <Globe2 className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{domain.name}</span>
            <Badge
              variant={domain.status === 'failed' ? 'destructive' : 'secondary'}
            >
              {domainStatusLabels[domain.status]}
            </Badge>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <DomainCapability enabled={domain.sendingEnabled} label="Sending" />
            <DomainCapability enabled={domain.routingEnabled} label="Routing" />
            <DomainCapability
              enabled={domain.catchAllEnabled}
              label="Catch-all"
            />
          </div>
          {domain.checkedAtLabel ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Last checked {domain.checkedAtLabel}
            </p>
          ) : null}
          {domain.error || error ? (
            <p className="mt-2 text-xs text-destructive">
              {error ?? domain.error}
            </p>
          ) : null}
        </div>
        {controller.canManage ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Refresh ${domain.name}`}
            disabled={refreshing}
            onClick={refresh}
          >
            <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
          </Button>
        ) : null}
      </div>
    </li>
  )
}

/** Production domain onboarding and verification status section. */
export function MailDomainSettings({
  controller,
}: {
  controller: ActiveMailSettingsController
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const registering = controller.pendingAction?.kind === 'register_domain'
  const action =
    controller.canManage && controller.domains.length > 0 ? (
      <Button size="sm" onClick={() => setDialogOpen(true)}>
        <Plus />
        Add domain
      </Button>
    ) : null

  return (
    <MailSettingsCard
      title="Company domains"
      description="Connect domains used by people and agents in this workspace."
      action={action}
    >
      {controller.domains.length > 0 ? (
        <ul className="overflow-hidden rounded-xl border">
          {controller.domains.map((domain) => (
            <DomainRow
              key={domain.id}
              domain={domain}
              controller={controller}
            />
          ))}
        </ul>
      ) : (
        <Empty className="border py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Globe2 />
            </EmptyMedia>
            <EmptyTitle>Connect a company domain</EmptyTitle>
            <EmptyDescription>
              Enter the company domain. Garden discovers and configures its
              managed mail routing before creating mailboxes.
            </EmptyDescription>
          </EmptyHeader>
          {controller.canManage ? (
            <EmptyContent className="max-w-md items-stretch text-left">
              <DomainForm
                controller={controller}
                formId="mail-domain-onboarding"
              />
              <Button
                type="submit"
                form="mail-domain-onboarding"
                disabled={registering}
              >
                {registering ? 'Connecting…' : 'Connect domain'}
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add company domain</DialogTitle>
            <DialogDescription>
              Connect an existing Cloudflare zone to Garden Mail.
            </DialogDescription>
          </DialogHeader>
          <DomainForm
            controller={controller}
            formId="mail-domain-dialog"
            onCreated={() => setDialogOpen(false)}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={registering}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="mail-domain-dialog"
              disabled={registering}
            >
              {registering ? 'Connecting…' : 'Connect domain'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MailSettingsCard>
  )
}
