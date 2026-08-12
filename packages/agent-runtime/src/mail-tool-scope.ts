import type {
  ConversationId,
  MailboxAccessLevel,
  MailboxId,
} from '@garden/core/mail'

export type MailAgentToolScope = {
  readonly mailboxes: ReadonlyArray<{
    readonly mailboxId: MailboxId
    readonly accessLevel: typeof MailboxAccessLevel.Type
  }>
  readonly selectedConversationId: ConversationId | null
}

/** Only provider accounts that can still execute may enter an Inbox toolkit. */
export const MAIL_EXECUTOR_ACTIVE_SYNC_STATUSES = [
  'connected',
  'syncing',
  'ready',
  'degraded',
] as const

const mailAccessRank: Readonly<Record<typeof MailboxAccessLevel.Type, number>> =
  { viewer: 0, editor: 1, owner: 2 }

/** Returns the less-privileged grant from member and agent access rows. */
export const minimumMailAccess = (
  member: typeof MailboxAccessLevel.Type,
  agent: typeof MailboxAccessLevel.Type,
): typeof MailboxAccessLevel.Type =>
  mailAccessRank[member] <= mailAccessRank[agent] ? member : agent
