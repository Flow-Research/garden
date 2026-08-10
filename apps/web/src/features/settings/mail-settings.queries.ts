import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  createMailSettingsAddress,
  createMailSettingsMailbox,
  getMailSettingsSnapshot,
  refreshMailSettingsDomain,
  registerMailSettingsDomain,
  removeMailSettingsAccess,
  setMailSettingsAccess,
  type MailSettingsSnapshot,
} from '@/lib/server/mail-settings-api'

const workspaceInput = z.object({ workspaceId: z.uuid() })
const domainRegistrationInput = workspaceInput.extend({
  name: z.string().trim().min(1),
  zoneId: z.string().trim().min(1),
  workerName: z.string().trim().min(1),
})
const refreshDomainInput = workspaceInput.extend({ domainId: z.uuid() })
const actorInput = z.discriminatedUnion('type', [
  z.object({ type: z.literal('member'), id: z.uuid() }),
  z.object({ type: z.literal('agent'), id: z.uuid() }),
])
const createMailboxInput = workspaceInput.extend({
  domainId: z.uuid(),
  name: z.string().trim().min(1),
  kind: z.enum(['personal', 'shared', 'agent']),
  primaryLocalPart: z.string().trim().min(1),
  owner: actorInput,
})
const createAddressInput = workspaceInput.extend({
  domainId: z.uuid(),
  mailboxId: z.uuid(),
  kind: z.enum(['alias', 'catch_all']),
  localPart: z.string().trim().min(1).optional(),
})
const setAccessInput = workspaceInput.extend({
  mailboxId: z.uuid(),
  actor: actorInput,
  level: z.enum(['owner', 'editor', 'viewer']),
})
const removeAccessInput = workspaceInput.extend({ accessId: z.uuid() })

export const mailSettingsKeys = {
  all: (workspaceId: string) => ['garden-mail-settings', workspaceId] as const,
  snapshot: (workspaceId: string) =>
    [...mailSettingsKeys.all(workspaceId), 'snapshot'] as const,
}

const getSettings = createServerFn({ method: 'GET' })
  .inputValidator(workspaceInput)
  .handler(({ context, data }) =>
    getMailSettingsSnapshot(
      requireAppRequestContext(context),
      data.workspaceId,
    ),
  )

export const registerDomain = createServerFn({ method: 'POST' })
  .inputValidator(domainRegistrationInput)
  .handler(({ context, data }) =>
    registerMailSettingsDomain(
      requireAppRequestContext(context),
      data.workspaceId,
      data,
    ),
  )

export const refreshDomain = createServerFn({ method: 'POST' })
  .inputValidator(refreshDomainInput)
  .handler(({ context, data }) =>
    refreshMailSettingsDomain(
      requireAppRequestContext(context),
      data.workspaceId,
      data.domainId,
    ),
  )

export const createMailbox = createServerFn({ method: 'POST' })
  .inputValidator(createMailboxInput)
  .handler(({ context, data }) =>
    createMailSettingsMailbox(
      requireAppRequestContext(context),
      data.workspaceId,
      data,
    ),
  )

export const createAddress = createServerFn({ method: 'POST' })
  .inputValidator(createAddressInput)
  .handler(({ context, data }) =>
    createMailSettingsAddress(
      requireAppRequestContext(context),
      data.workspaceId,
      data,
    ),
  )

export const setAccess = createServerFn({ method: 'POST' })
  .inputValidator(setAccessInput)
  .handler(({ context, data }) =>
    setMailSettingsAccess(
      requireAppRequestContext(context),
      data.workspaceId,
      data,
    ),
  )

export const removeAccess = createServerFn({ method: 'POST' })
  .inputValidator(removeAccessInput)
  .handler(({ context, data }) =>
    removeMailSettingsAccess(
      requireAppRequestContext(context),
      data.workspaceId,
      data.accessId,
    ),
  )

/** Authenticated workspace mail administration cache. */
export function mailSettingsOptions(workspaceId: string) {
  return queryOptions({
    queryKey: mailSettingsKeys.snapshot(workspaceId),
    queryFn: (): Promise<MailSettingsSnapshot> =>
      getSettings({ data: { workspaceId } }),
    staleTime: 10_000,
  })
}
