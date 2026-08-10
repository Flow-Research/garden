// Directly adapts Cloudflare Agentic Inbox mailbox rows/create dialog (Apache-2.0)
// and Zero settings/access rows (MIT). Pinned sources: docs/architecture/garden-mail-ui-sources.md.

import { useState, type FormEvent } from 'react'
import { AtSign, Bot, Inbox, Plus, Trash2, UserRound } from 'lucide-react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@garden/ui/components/ui/select'
import type {
  ActiveMailSettingsController,
  CreateMailAddressSettingsInput,
  CreateMailboxSettingsInput,
  MailboxAccessSettingsView,
  MailboxSettingsView,
  MailSettingsActorView,
} from '../mail-settings-controller'
import { MailSettingsCard } from './mail-settings-card'

const mailboxKindLabels: Record<MailboxSettingsView['kind'], string> = {
  personal: 'Personal',
  shared: 'Shared',
  agent: 'Agent',
}

const accessLevelLabels: Record<MailboxAccessSettingsView['level'], string> = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
}

function actorValue(actor: Pick<MailSettingsActorView, 'type' | 'id'>) {
  return `${actor.type}:${actor.id}`
}

/**
 * Cloudflare's create-mailbox dialog adapted to Garden's human/agent ownership
 * model. Defaults are derived during render so actor/domain data never needs an
 * effect-driven synchronization pass.
 */
function CreateMailboxDialog({
  controller,
  open,
  onOpenChange,
}: {
  controller: ActiveMailSettingsController
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const activeDomains = controller.domains.filter(
    (domain) => domain.status === 'active',
  )
  const [domainId, setDomainId] = useState('')
  const [localPart, setLocalPart] = useState('')
  const [name, setName] = useState('')
  const [kind, setKind] = useState<MailboxSettingsView['kind']>('shared')
  const [ownerValue, setOwnerValue] = useState('')
  const [error, setError] = useState<string>()
  const selectedDomainId = domainId || activeDomains[0]?.id || ''
  const selectedOwnerValue =
    ownerValue || actorValue(controller.actors[0] ?? { type: 'member', id: '' })
  const creating = controller.pendingAction?.kind === 'create_mailbox'

  const reset = () => {
    setDomainId('')
    setLocalPart('')
    setName('')
    setKind('shared')
    setOwnerValue('')
    setError(undefined)
  }

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const owner = controller.actors.find(
      (actor) => actorValue(actor) === selectedOwnerValue,
    )
    if (!owner) {
      setError('Choose a workspace member or agent to own this mailbox.')
      return
    }
    setError(undefined)
    const input: CreateMailboxSettingsInput = {
      domainId: selectedDomainId,
      name: name.trim() || localPart.trim(),
      kind,
      primaryLocalPart: localPart.trim(),
      owner: { type: owner.type, id: owner.id },
    }
    const result = await controller.actions.createMailbox(input)
    result.match({
      ok: () => changeOpen(false),
      err: (failure) => setError(failure.message),
    })
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New mailbox</DialogTitle>
          <DialogDescription>
            Create an address for a person, shared team, or agent.
          </DialogDescription>
        </DialogHeader>
        <form id="create-mailbox-form" onSubmit={submit} className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-1.5">
            <label htmlFor="mailbox-address" className="text-sm font-medium">
              Email address
            </label>
            <div className="flex items-center rounded-lg border focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
              <Input
                id="mailbox-address"
                value={localPart}
                onChange={(event) => setLocalPart(event.target.value)}
                className="border-0 shadow-none focus-visible:ring-0"
                placeholder="support"
                autoComplete="off"
                required
                disabled={creating}
              />
              <span className="text-sm text-muted-foreground">@</span>
              <Select
                value={selectedDomainId}
                onValueChange={(value) => setDomainId(value ?? '')}
              >
                <SelectTrigger className="h-8 max-w-40 border-0 shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {activeDomains.map((domain) => (
                    <SelectItem key={domain.id} value={domain.id}>
                      {domain.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="mailbox-name" className="text-sm font-medium">
              Display name{' '}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </label>
            <Input
              id="mailbox-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Customer Support"
              disabled={creating}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Mailbox type</label>
              <Select
                value={kind}
                onValueChange={(value) => {
                  if (value) setKind(value as MailboxSettingsView['kind'])
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">Personal</SelectItem>
                  <SelectItem value="shared">Shared</SelectItem>
                  <SelectItem value="agent">Agent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Owner</label>
              <Select
                value={selectedOwnerValue}
                onValueChange={(value) => setOwnerValue(value ?? '')}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {controller.actors.map((actor) => (
                    <SelectItem
                      key={actorValue(actor)}
                      value={actorValue(actor)}
                    >
                      {actor.name} ·{' '}
                      {actor.type === 'agent' ? 'Agent' : 'Member'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </form>
        <DialogFooter>
          <Button
            variant="outline"
            type="button"
            onClick={() => changeOpen(false)}
            disabled={creating}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="create-mailbox-form"
            disabled={
              creating ||
              !localPart.trim() ||
              !selectedDomainId ||
              controller.actors.length === 0
            }
          >
            {creating ? 'Creating…' : 'Create mailbox'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Address dialog follows Agentic Inbox's local-part/domain field treatment. */
function CreateAddressDialog({
  mailbox,
  controller,
  open,
  onOpenChange,
}: {
  mailbox: MailboxSettingsView
  controller: ActiveMailSettingsController
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [kind, setKind] =
    useState<CreateMailAddressSettingsInput['kind']>('alias')
  const [localPart, setLocalPart] = useState('')
  const [error, setError] = useState<string>()
  const domain = controller.domains.find((item) => item.id === mailbox.domainId)
  const creating =
    controller.pendingAction?.kind === 'create_address' &&
    controller.pendingAction.mailboxId === mailbox.id

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen) {
      setKind('alias')
      setLocalPart('')
      setError(undefined)
    }
    onOpenChange(nextOpen)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(undefined)
    const result = await controller.actions.createAddress({
      domainId: mailbox.domainId,
      mailboxId: mailbox.id,
      kind,
      ...(kind === 'alias' ? { localPart: localPart.trim() } : {}),
    })
    result.match({
      ok: () => changeOpen(false),
      err: (failure) => setError(failure.message),
    })
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add address</DialogTitle>
          <DialogDescription>
            Route another domain address to {mailbox.primaryAddress}.
          </DialogDescription>
        </DialogHeader>
        <form
          id={`create-address-${mailbox.id}`}
          onSubmit={submit}
          className="space-y-4"
        >
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Address type</label>
            <Select
              value={kind}
              onValueChange={(value) => {
                if (value)
                  setKind(value as CreateMailAddressSettingsInput['kind'])
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="alias">Alias</SelectItem>
                <SelectItem value="catch_all">Catch-all</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {kind === 'alias' ? (
            <div className="space-y-1.5">
              <label
                htmlFor={`address-${mailbox.id}`}
                className="text-sm font-medium"
              >
                Alias
              </label>
              <div className="flex items-center rounded-lg border pr-3 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
                <Input
                  id={`address-${mailbox.id}`}
                  value={localPart}
                  onChange={(event) => setLocalPart(event.target.value)}
                  className="border-0 shadow-none focus-visible:ring-0"
                  placeholder="hello"
                  required
                  disabled={creating}
                />
                <span className="text-sm text-muted-foreground">
                  @{domain?.name}
                </span>
              </div>
            </div>
          ) : (
            <p className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
              Any unmatched address at @{domain?.name} will route to this
              mailbox.
            </p>
          )}
        </form>
        <DialogFooter>
          <Button
            variant="outline"
            type="button"
            onClick={() => changeOpen(false)}
            disabled={creating}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form={`create-address-${mailbox.id}`}
            disabled={creating || (kind === 'alias' && !localPart.trim())}
          >
            {creating ? 'Adding…' : 'Add address'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AccessActor({ actor }: { actor: MailSettingsActorView }) {
  const Icon = actor.type === 'agent' ? Bot : UserRound
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{actor.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {actor.detail}
        </div>
      </div>
    </div>
  )
}

/** Human/agent access editor remains controller-owned and permission-gated. */
function MailboxAccessEditor({
  mailbox,
  controller,
}: {
  mailbox: MailboxSettingsView
  controller: ActiveMailSettingsController
}) {
  const availableActors = controller.actors.filter(
    (actor) =>
      !mailbox.access.some(
        (access) => actorValue(access.actor) === actorValue(actor),
      ),
  )
  const [selectedActor, setSelectedActor] = useState('')
  const [level, setLevel] =
    useState<MailboxAccessSettingsView['level']>('editor')
  const [error, setError] = useState<string>()
  const effectiveActor =
    selectedActor || (availableActors[0] ? actorValue(availableActors[0]) : '')
  const setting =
    controller.pendingAction?.kind === 'set_access' &&
    controller.pendingAction.mailboxId === mailbox.id

  const grant = async () => {
    const actor = availableActors.find(
      (candidate) => actorValue(candidate) === effectiveActor,
    )
    if (!actor) return
    setError(undefined)
    const result = await controller.actions.setAccess({
      mailboxId: mailbox.id,
      actor: { type: actor.type, id: actor.id },
      level,
    })
    result.match({
      ok: () => setSelectedActor(''),
      err: (failure) => setError(failure.message),
    })
  }

  const updateLevel = async (
    access: MailboxAccessSettingsView,
    nextLevel: MailboxAccessSettingsView['level'],
  ) => {
    setError(undefined)
    const result = await controller.actions.setAccess({
      mailboxId: mailbox.id,
      actor: { type: access.actor.type, id: access.actor.id },
      level: nextLevel,
    })
    result.match({
      ok: () => undefined,
      err: (failure) => setError(failure.message),
    })
  }

  const remove = async (access: MailboxAccessSettingsView) => {
    setError(undefined)
    const result = await controller.actions.removeAccess(access.id)
    result.match({
      ok: () => undefined,
      err: (failure) => setError(failure.message),
    })
  }

  return (
    <div className="border-t px-5 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Human and agent access
        </h4>
      </div>
      {error ? <p className="mb-3 text-xs text-destructive">{error}</p> : null}
      <ul className="space-y-3">
        {mailbox.access.map((access) => {
          const removing =
            controller.pendingAction?.kind === 'remove_access' &&
            controller.pendingAction.accessId === access.id
          return (
            <li key={access.id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <AccessActor actor={access.actor} />
              </div>
              {controller.canManage && access.level !== 'owner' ? (
                <Select
                  value={access.level}
                  onValueChange={(value) => {
                    if (value)
                      updateLevel(
                        access,
                        value as MailboxAccessSettingsView['level'],
                      )
                  }}
                >
                  <SelectTrigger size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="editor">Editor</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant="secondary">
                  {accessLevelLabels[access.level]}
                </Badge>
              )}
              {controller.canManage && access.level !== 'owner' ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${access.actor.name} from ${mailbox.name}`}
                  disabled={removing}
                  onClick={() => remove(access)}
                >
                  <Trash2 />
                </Button>
              ) : null}
            </li>
          )
        })}
      </ul>
      {controller.canManage && availableActors.length > 0 ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_110px_auto]">
          <Select
            value={effectiveActor}
            onValueChange={(value) => setSelectedActor(value ?? '')}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableActors.map((actor) => (
                <SelectItem key={actorValue(actor)} value={actorValue(actor)}>
                  {actor.name} · {actor.type === 'agent' ? 'Agent' : 'Member'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={level}
            onValueChange={(value) => {
              if (value) setLevel(value as MailboxAccessSettingsView['level'])
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="editor">Editor</SelectItem>
              <SelectItem value="viewer">Viewer</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            onClick={grant}
            disabled={setting}
          >
            {setting ? 'Adding…' : 'Add access'}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function MailboxRow({
  mailbox,
  controller,
}: {
  mailbox: MailboxSettingsView
  controller: ActiveMailSettingsController
}) {
  const [addressOpen, setAddressOpen] = useState(false)

  return (
    <li className="[content-visibility:auto] [contain-intrinsic-size:0_260px] [&+&]:border-t">
      <div className="flex items-start gap-4 px-5 py-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
          {mailbox.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{mailbox.name}</span>
            <Badge variant="secondary">{mailboxKindLabels[mailbox.kind]}</Badge>
            {mailbox.status === 'disabled' ? (
              <Badge variant="outline">Disabled</Badge>
            ) : null}
          </div>
          <p className="truncate text-sm text-muted-foreground">
            {mailbox.primaryAddress}
          </p>
        </div>
      </div>
      <div className="border-t px-5 py-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Addresses
          </h4>
          {controller.canManage ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setAddressOpen(true)}
            >
              <Plus />
              Add address
            </Button>
          ) : null}
        </div>
        <ul className="space-y-2">
          {mailbox.addresses.map((address) => (
            <li key={address.id} className="flex items-center gap-2 text-sm">
              <AtSign className="size-3.5 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{address.address}</span>
              <Badge variant="outline">
                {address.kind === 'catch_all'
                  ? 'Catch-all'
                  : address.kind === 'primary'
                    ? 'Primary'
                    : 'Alias'}
              </Badge>
            </li>
          ))}
        </ul>
      </div>
      <MailboxAccessEditor mailbox={mailbox} controller={controller} />
      <CreateAddressDialog
        mailbox={mailbox}
        controller={controller}
        open={addressOpen}
        onOpenChange={setAddressOpen}
      />
    </li>
  )
}

/** Mailbox/address/access settings using the source products' exact hierarchy. */
export function MailMailboxSettings({
  controller,
}: {
  controller: ActiveMailSettingsController
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const hasActiveDomain = controller.domains.some(
    (domain) => domain.status === 'active',
  )
  const canCreate =
    controller.canManage && hasActiveDomain && controller.actors.length > 0

  return (
    <MailSettingsCard
      title="Mailboxes"
      description="Addresses where workspace members and agents collaborate."
      action={
        canCreate && controller.mailboxes.length > 0 ? (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus />
            New mailbox
          </Button>
        ) : null
      }
    >
      {controller.mailboxes.length > 0 ? (
        <ul className="overflow-hidden rounded-xl border">
          {controller.mailboxes.map((mailbox) => (
            <MailboxRow
              key={mailbox.id}
              mailbox={mailbox}
              controller={controller}
            />
          ))}
        </ul>
      ) : (
        <Empty className="border py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Inbox />
            </EmptyMedia>
            <EmptyTitle>No mailboxes yet</EmptyTitle>
            <EmptyDescription>
              {hasActiveDomain
                ? 'Create a mailbox for a person, shared team, or agent.'
                : 'Activate a company domain before creating a mailbox.'}
            </EmptyDescription>
          </EmptyHeader>
          {canCreate ? (
            <EmptyContent>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus />
                New mailbox
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      )}
      <CreateMailboxDialog
        controller={controller}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </MailSettingsCard>
  )
}
