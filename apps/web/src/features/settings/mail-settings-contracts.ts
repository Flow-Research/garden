export type MailSettingsActorView = {
  type: 'member' | 'agent'
  id: string
  name: string
  detail: string
}

export type MailDomainSettingsView = {
  id: string
  name: string
  status: 'pending_verification' | 'active' | 'suspended' | 'failed'
  sendingEnabled: boolean
  routingEnabled: boolean
  catchAllEnabled: boolean
  checkedAtLabel?: string
  error?: string
}

export type MailAddressSettingsView = {
  id: string
  address: string
  kind: 'primary' | 'alias' | 'catch_all'
  status: 'active' | 'disabled'
}

export type MailboxAccessSettingsView = {
  id: string
  actor: MailSettingsActorView
  level: 'owner' | 'editor' | 'viewer'
}

export type MailboxSettingsView = {
  id: string
  domainId: string
  name: string
  kind: 'personal' | 'shared' | 'agent'
  status: 'active' | 'disabled'
  primaryAddress: string
  addresses: MailAddressSettingsView[]
  access: MailboxAccessSettingsView[]
}

export type RegisterMailDomainSettingsInput = {
  name: string
  zoneId: string
  workerName: string
}

export type CreateMailboxSettingsInput = {
  domainId: string
  name: string
  kind: MailboxSettingsView['kind']
  primaryLocalPart: string
  owner: Pick<MailSettingsActorView, 'type' | 'id'>
}

export type CreateMailAddressSettingsInput = {
  domainId: string
  mailboxId: string
  kind: 'alias' | 'catch_all'
  localPart?: string
}

export type SetMailboxAccessSettingsInput = {
  mailboxId: string
  actor: Pick<MailSettingsActorView, 'type' | 'id'>
  level: MailboxAccessSettingsView['level']
}
