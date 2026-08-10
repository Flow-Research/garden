import type { GardenDatabase } from '@garden/db'
import {
  agent,
  mailAddress,
  mailDomain,
  mailMailbox,
  mailMailboxAccess,
  member,
} from '@garden/db/schema'
import {
  MailAddress,
  type MailAddressKind,
  type MailActor,
  type DomainName,
  type LocalPart,
  MailDomain,
  type MailDomainId,
  type MailDomainStatus,
  Mailbox,
  MailboxAccess,
  type MailboxAccessLevel,
  type MailboxId,
  type ProviderEvidence,
  type ProviderKey,
  type ProviderObjectId,
  type UtcTimestamp,
  type WorkspaceId,
} from '@garden/core/mail'
import { and, asc, eq } from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import {
  MailProvisioningActorError,
  MailProvisioningConflictError,
  MailProvisioningNotFoundError,
  MailProvisioningPersistenceError,
  type ProvisionedMailbox,
  type ProvisionMailboxInput,
} from './provisioning-contracts.ts'

type ProvisioningTransaction = Parameters<
  Parameters<GardenDatabase['transaction']>[0]
>[0]
type ProvisioningDatabase = GardenDatabase | ProvisioningTransaction

type PersistenceError =
  | MailProvisioningActorError
  | MailProvisioningConflictError
  | MailProvisioningNotFoundError
  | MailProvisioningPersistenceError

export interface ReserveDomainInput {
  readonly workspaceId: WorkspaceId
  readonly name: DomainName
  readonly transportProvider: ProviderKey
  readonly providerEvidence: ProviderEvidence
}

export interface UpdateDomainInput {
  readonly workspaceId: WorkspaceId
  readonly domainId: MailDomainId
  readonly status: MailDomainStatus
  readonly transportProvider: ProviderKey
  readonly providerDomainId: ProviderObjectId
  readonly providerEvidence: ProviderEvidence
  readonly verifiedAt: UtcTimestamp | null
}

export interface PersistAddressInput {
  readonly workspaceId: WorkspaceId
  readonly domainId: MailDomainId
  readonly mailboxId: MailboxId
  readonly localPart: LocalPart
  readonly kind: MailAddressKind
}

export interface PersistAccessInput {
  readonly workspaceId: WorkspaceId
  readonly mailboxId: MailboxId
  readonly actor: MailActor
  readonly accessLevel: MailboxAccessLevel
}

/** Maps database Promise failures into the provisioning subsystem. */
const databaseEffect = <A>(
  operation: string,
  run: () => PromiseLike<A>,
): Effect.Effect<A, MailProvisioningPersistenceError> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new MailProvisioningPersistenceError({
        operation,
        message: 'Garden Mail provisioning persistence failed.',
        cause,
      }),
  })

/** Decodes every persisted row before it re-enters the application layer. */
const decodeRow = <A>(
  schema: Schema.Decoder<A, never>,
  value: unknown,
  operation: string,
): Effect.Effect<A, MailProvisioningPersistenceError> =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(
      (cause) =>
        new MailProvisioningPersistenceError({
          operation,
          message: 'Garden Mail provisioning returned an invalid row.',
          cause,
        }),
    ),
  )

/** Preserves typed failures rejected through a Drizzle transaction Promise. */
const transactionFailure = (
  operation: string,
  cause: unknown,
): PersistenceError => {
  if (
    cause instanceof MailProvisioningActorError ||
    cause instanceof MailProvisioningConflictError ||
    cause instanceof MailProvisioningNotFoundError ||
    cause instanceof MailProvisioningPersistenceError
  ) {
    return cause
  }
  return new MailProvisioningPersistenceError({
    operation,
    message: 'Garden Mail provisioning transaction failed.',
    cause,
  })
}

/** Runs a provisioning mutation atomically without swallowing typed errors. */
const inTransaction = <A>(
  db: GardenDatabase,
  operation: string,
  program: (tx: ProvisioningTransaction) => Effect.Effect<A, PersistenceError>,
): Effect.Effect<A, PersistenceError> =>
  Effect.tryPromise({
    try: () => db.transaction((tx) => Effect.runPromise(program(tx))),
    catch: (cause) => transactionFailure(operation, cause),
  })

/** Restores the canonical discriminated actor from exclusive columns. */
const actorValue = (row: {
  readonly actorType: string
  readonly memberId: string | null
  readonly agentId: string | null
}): unknown =>
  row.actorType === 'member'
    ? { _tag: 'Member', memberId: row.memberId }
    : { _tag: 'Agent', agentId: row.agentId }

/** Flattens a canonical actor for checked relational columns. */
const storedActor = (actor: MailActor) =>
  actor._tag === 'Member'
    ? { actorType: 'member' as const, memberId: actor.memberId, agentId: null }
    : { actorType: 'agent' as const, memberId: null, agentId: actor.agentId }

/** Canonical domain projection from a selected Drizzle row. */
const decodeDomain = (
  row: typeof mailDomain.$inferSelect,
  operation: string,
): Effect.Effect<MailDomain, MailProvisioningPersistenceError> =>
  decodeRow(
    MailDomain,
    {
      ...row,
      providerEvidence: row.providerEvidence ?? null,
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
    operation,
  )

/** Canonical mailbox projection from a selected Drizzle row. */
const decodeMailbox = (
  row: typeof mailMailbox.$inferSelect,
  operation: string,
): Effect.Effect<Mailbox, MailProvisioningPersistenceError> =>
  decodeRow(
    Mailbox,
    {
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
    operation,
  )

/** Canonical address projection from a selected Drizzle row. */
const decodeAddress = (
  row: typeof mailAddress.$inferSelect,
  operation: string,
): Effect.Effect<MailAddress, MailProvisioningPersistenceError> =>
  decodeRow(
    MailAddress,
    {
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
    operation,
  )

/** Canonical access projection from checked actor discriminator columns. */
const decodeAccess = (
  row: typeof mailMailboxAccess.$inferSelect,
  operation: string,
): Effect.Effect<MailboxAccess, MailProvisioningPersistenceError> =>
  decodeRow(
    MailboxAccess,
    {
      id: row.id,
      workspaceId: row.workspaceId,
      mailboxId: row.mailboxId,
      actor: actorValue(row),
      accessLevel: row.accessLevel,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
    operation,
  )

/** Proves an access target belongs to the operation's workspace. */
const requireActorInWorkspace = Effect.fn(
  'MailProvisioningPersistence.requireActorInWorkspace',
)(function* (
  db: ProvisioningDatabase,
  workspaceId: WorkspaceId,
  actor: MailActor,
  operation: string,
) {
  const rows =
    actor._tag === 'Member'
      ? yield* databaseEffect(operation, () =>
          db
            .select({ id: member.id })
            .from(member)
            .where(
              and(
                eq(member.id, actor.memberId),
                eq(member.organizationId, workspaceId),
              ),
            )
            .limit(1),
        )
      : yield* databaseEffect(operation, () =>
          db
            .select({ id: agent.id })
            .from(agent)
            .where(
              and(
                eq(agent.id, actor.agentId),
                eq(agent.workspaceId, workspaceId),
              ),
            )
            .limit(1),
        )

  if (rows[0] === undefined) {
    return yield* new MailProvisioningActorError({
      workspaceId,
      actor,
      operation,
      message: 'Mailbox access actor does not belong to this workspace.',
    })
  }
})

/** Looks up a domain only through its owning workspace. */
export const getProvisionedDomain = Effect.fn(
  'MailProvisioningPersistence.getDomain',
)(function* (
  db: ProvisioningDatabase,
  input: { readonly workspaceId: WorkspaceId; readonly domainId: MailDomainId },
) {
  const rows = yield* databaseEffect('getDomain.select', () =>
    db
      .select()
      .from(mailDomain)
      .where(
        and(
          eq(mailDomain.workspaceId, input.workspaceId),
          eq(mailDomain.id, input.domainId),
        ),
      )
      .limit(1),
  )
  const row = rows[0]
  if (row === undefined) {
    return yield* new MailProvisioningNotFoundError({
      workspaceId: input.workspaceId,
      resourceType: 'domain',
      resourceId: input.domainId,
      operation: 'getDomain',
      message: 'Mail domain does not exist in this workspace.',
    })
  }
  return yield* decodeDomain(row, 'getDomain.decode')
})

/** Lists only domains owned by the requested workspace. */
export const listProvisionedDomains = Effect.fn(
  'MailProvisioningPersistence.listDomains',
)(function* (db: GardenDatabase, workspaceId: WorkspaceId) {
  const rows = yield* databaseEffect('listDomains.select', () =>
    db
      .select()
      .from(mailDomain)
      .where(eq(mailDomain.workspaceId, workspaceId))
      .orderBy(asc(mailDomain.name)),
  )
  return yield* Effect.forEach(rows, (row) =>
    decodeDomain(row, 'listDomains.decode'),
  )
})

/**
 * Reserves a domain before provider calls. Repeated registration in the same
 * workspace is idempotent; global domain ownership remains exclusive.
 */
export const reserveProvisionedDomain = Effect.fn(
  'MailProvisioningPersistence.reserveDomain',
)(function* (db: GardenDatabase, input: ReserveDomainInput) {
  return yield* inTransaction(db, 'reserveDomain', (tx) =>
    Effect.gen(function* () {
      const inserted = yield* databaseEffect('reserveDomain.insert', () =>
        tx
          .insert(mailDomain)
          .values({
            workspaceId: input.workspaceId,
            name: input.name,
            status: 'pending_verification',
            transportProvider: input.transportProvider,
            providerEvidence: input.providerEvidence,
          })
          .onConflictDoNothing()
          .returning(),
      )
      const insertedRow = inserted[0]
      if (insertedRow !== undefined) {
        return yield* decodeDomain(insertedRow, 'reserveDomain.decodeInserted')
      }

      const existing = yield* databaseEffect('reserveDomain.findExisting', () =>
        tx
          .select()
          .from(mailDomain)
          .where(eq(mailDomain.name, input.name))
          .limit(1),
      )
      const row = existing[0]
      if (row === undefined || row.workspaceId !== input.workspaceId) {
        return yield* new MailProvisioningConflictError({
          workspaceId: input.workspaceId,
          resourceType: 'domain',
          value: input.name,
          operation: 'reserveDomain',
          message: 'Mail domain is already registered to another workspace.',
        })
      }
      return yield* decodeDomain(row, 'reserveDomain.decodeExisting')
    }),
  )
})

/** Atomically records the latest provider observation for one workspace domain. */
export const updateProvisionedDomain = Effect.fn(
  'MailProvisioningPersistence.updateDomain',
)(function* (db: GardenDatabase, input: UpdateDomainInput) {
  const rows = yield* databaseEffect('updateDomain.update', () =>
    db
      .update(mailDomain)
      .set({
        status: input.status,
        transportProvider: input.transportProvider,
        providerDomainId: input.providerDomainId,
        providerEvidence: input.providerEvidence,
        verifiedAt:
          input.verifiedAt === null ? null : new Date(input.verifiedAt),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mailDomain.workspaceId, input.workspaceId),
          eq(mailDomain.id, input.domainId),
        ),
      )
      .returning(),
  )
  const row = rows[0]
  if (row === undefined) {
    return yield* new MailProvisioningNotFoundError({
      workspaceId: input.workspaceId,
      resourceType: 'domain',
      resourceId: input.domainId,
      operation: 'updateDomain',
      message: 'Mail domain does not exist in this workspace.',
    })
  }
  return yield* decodeDomain(row, 'updateDomain.decode')
})

/** Creates mailbox, primary address, and owner access in one transaction. */
export const persistMailbox = Effect.fn(
  'MailProvisioningPersistence.createMailbox',
)(function* (db: GardenDatabase, input: ProvisionMailboxInput) {
  return yield* inTransaction(db, 'createMailbox', (tx) =>
    Effect.gen(function* () {
      const domains = yield* databaseEffect('createMailbox.findDomain', () =>
        tx
          .select({ id: mailDomain.id, name: mailDomain.name })
          .from(mailDomain)
          .where(
            and(
              eq(mailDomain.workspaceId, input.workspaceId),
              eq(mailDomain.id, input.domainId),
            ),
          )
          .limit(1),
      )
      const domain = domains[0]
      if (domain === undefined) {
        return yield* new MailProvisioningNotFoundError({
          workspaceId: input.workspaceId,
          resourceType: 'domain',
          resourceId: input.domainId,
          operation: 'createMailbox',
          message: 'Mail domain does not exist in this workspace.',
        })
      }
      if (input.primaryLocalPart === '*') {
        return yield* new MailProvisioningConflictError({
          workspaceId: input.workspaceId,
          resourceType: 'primary_address',
          value: `*@${domain.name}`,
          operation: 'createMailbox',
          message: 'Catch-all cannot be used as a primary address.',
        })
      }
      yield* requireActorInWorkspace(
        tx,
        input.workspaceId,
        input.owner,
        'createMailbox.validateOwner',
      )

      const addressConflict = yield* databaseEffect(
        'createMailbox.findAddress',
        () =>
          tx
            .select({ id: mailAddress.id })
            .from(mailAddress)
            .where(
              and(
                eq(mailAddress.domainId, input.domainId),
                eq(mailAddress.localPart, input.primaryLocalPart),
              ),
            )
            .limit(1),
      )
      if (addressConflict[0] !== undefined) {
        return yield* new MailProvisioningConflictError({
          workspaceId: input.workspaceId,
          resourceType: 'mail_address',
          value: `${input.primaryLocalPart}@${domain.name}`,
          operation: 'createMailbox',
          message: 'Mail address already exists.',
        })
      }

      const mailboxRows = yield* databaseEffect(
        'createMailbox.insertMailbox',
        () =>
          tx
            .insert(mailMailbox)
            .values({
              workspaceId: input.workspaceId,
              name: input.name,
              kind: input.kind,
            })
            .returning(),
      )
      const mailboxRow = mailboxRows[0]
      if (mailboxRow === undefined) {
        return yield* new MailProvisioningPersistenceError({
          operation: 'createMailbox.insertMailbox',
          message: 'Mailbox insert returned no row.',
        })
      }

      const addressRows = yield* databaseEffect(
        'createMailbox.insertAddress',
        () =>
          tx
            .insert(mailAddress)
            .values({
              workspaceId: input.workspaceId,
              domainId: input.domainId,
              mailboxId: mailboxRow.id,
              localPart: input.primaryLocalPart,
              kind: 'primary',
            })
            .onConflictDoNothing()
            .returning(),
      )
      const addressRow = addressRows[0]
      if (addressRow === undefined) {
        return yield* new MailProvisioningConflictError({
          workspaceId: input.workspaceId,
          resourceType: 'mail_address',
          value: `${input.primaryLocalPart}@${domain.name}`,
          operation: 'createMailbox.insertAddress',
          message: 'Mail address was concurrently assigned.',
        })
      }

      const owner = storedActor(input.owner)
      const accessRows = yield* databaseEffect(
        'createMailbox.insertOwner',
        () =>
          tx
            .insert(mailMailboxAccess)
            .values({
              workspaceId: input.workspaceId,
              mailboxId: mailboxRow.id,
              actorType: owner.actorType,
              memberId: owner.memberId,
              agentId: owner.agentId,
              accessLevel: 'owner',
            })
            .returning(),
      )
      const accessRow = accessRows[0]
      if (accessRow === undefined) {
        return yield* new MailProvisioningPersistenceError({
          operation: 'createMailbox.insertOwner',
          message: 'Owner access insert returned no row.',
        })
      }

      const mailbox = yield* decodeMailbox(
        mailboxRow,
        'createMailbox.decodeMailbox',
      )
      const primaryAddress = yield* decodeAddress(
        addressRow,
        'createMailbox.decodeAddress',
      )
      const ownerAccess = yield* decodeAccess(
        accessRow,
        'createMailbox.decodeOwner',
      )
      return {
        mailbox,
        primaryAddress,
        ownerAccess,
      } satisfies ProvisionedMailbox
    }),
  )
})

/** Creates one alias or catch-all after proving both links share a workspace. */
export const persistAddress = Effect.fn(
  'MailProvisioningPersistence.createAddress',
)(function* (db: GardenDatabase, input: PersistAddressInput) {
  return yield* inTransaction(db, 'createAddress', (tx) =>
    Effect.gen(function* () {
      const linked = yield* databaseEffect('createAddress.findLinks', () =>
        tx
          .select({
            domainName: mailDomain.name,
            mailboxId: mailMailbox.id,
          })
          .from(mailDomain)
          .innerJoin(
            mailMailbox,
            eq(mailMailbox.workspaceId, mailDomain.workspaceId),
          )
          .where(
            and(
              eq(mailDomain.workspaceId, input.workspaceId),
              eq(mailDomain.id, input.domainId),
              eq(mailMailbox.id, input.mailboxId),
            ),
          )
          .limit(1),
      )
      const link = linked[0]
      if (link === undefined) {
        return yield* new MailProvisioningNotFoundError({
          workspaceId: input.workspaceId,
          resourceType: 'domain_or_mailbox',
          resourceId: `${input.domainId}:${input.mailboxId}`,
          operation: 'createAddress',
          message: 'Mail domain and mailbox must exist in this workspace.',
        })
      }

      const existingRows = yield* databaseEffect(
        'createAddress.findExisting',
        () =>
          tx
            .select()
            .from(mailAddress)
            .where(
              and(
                eq(mailAddress.domainId, input.domainId),
                eq(mailAddress.localPart, input.localPart),
              ),
            )
            .limit(1),
      )
      const existing = existingRows[0]
      if (existing !== undefined) {
        if (
          existing.workspaceId === input.workspaceId &&
          existing.mailboxId === input.mailboxId &&
          existing.kind === input.kind
        ) {
          return yield* decodeAddress(existing, 'createAddress.decodeExisting')
        }
        return yield* new MailProvisioningConflictError({
          workspaceId: input.workspaceId,
          resourceType: 'mail_address',
          value: `${input.localPart}@${link.domainName}`,
          operation: 'createAddress',
          message: 'Mail address is already assigned.',
        })
      }

      const rows = yield* databaseEffect('createAddress.insert', () =>
        tx
          .insert(mailAddress)
          .values({
            workspaceId: input.workspaceId,
            domainId: input.domainId,
            mailboxId: input.mailboxId,
            localPart: input.localPart,
            kind: input.kind,
          })
          .onConflictDoNothing()
          .returning(),
      )
      const row = rows[0]
      if (row !== undefined) {
        return yield* decodeAddress(row, 'createAddress.decode')
      }

      const concurrentRows = yield* databaseEffect(
        'createAddress.findConcurrent',
        () =>
          tx
            .select()
            .from(mailAddress)
            .where(
              and(
                eq(mailAddress.domainId, input.domainId),
                eq(mailAddress.localPart, input.localPart),
              ),
            )
            .limit(1),
      )
      const concurrent = concurrentRows[0]
      if (concurrent === undefined) {
        return yield* new MailProvisioningPersistenceError({
          operation: 'createAddress.insert',
          message: 'Mail address conflict returned no persisted row.',
        })
      }
      if (
        concurrent.workspaceId === input.workspaceId &&
        concurrent.mailboxId === input.mailboxId &&
        concurrent.kind === input.kind
      ) {
        return yield* decodeAddress(
          concurrent,
          'createAddress.decodeConcurrent',
        )
      }
      return yield* new MailProvisioningConflictError({
        workspaceId: input.workspaceId,
        resourceType: 'mail_address',
        value: `${input.localPart}@${link.domainName}`,
        operation: 'createAddress',
        message: 'Mail address is already assigned.',
      })
    }),
  )
})

/** Upserts one workspace-validated member or agent access grant. */
export const persistMailboxAccess = Effect.fn(
  'MailProvisioningPersistence.setMailboxAccess',
)(function* (db: GardenDatabase, input: PersistAccessInput) {
  return yield* inTransaction(db, 'setMailboxAccess', (tx) =>
    Effect.gen(function* () {
      const mailboxes = yield* databaseEffect(
        'setMailboxAccess.findMailbox',
        () =>
          tx
            .select({ id: mailMailbox.id })
            .from(mailMailbox)
            .where(
              and(
                eq(mailMailbox.workspaceId, input.workspaceId),
                eq(mailMailbox.id, input.mailboxId),
              ),
            )
            .limit(1),
      )
      if (mailboxes[0] === undefined) {
        return yield* new MailProvisioningNotFoundError({
          workspaceId: input.workspaceId,
          resourceType: 'mailbox',
          resourceId: input.mailboxId,
          operation: 'setMailboxAccess',
          message: 'Mailbox does not exist in this workspace.',
        })
      }
      yield* requireActorInWorkspace(
        tx,
        input.workspaceId,
        input.actor,
        'setMailboxAccess.validateActor',
      )

      const actor = storedActor(input.actor)
      const actorPredicate =
        input.actor._tag === 'Member'
          ? and(
              eq(mailMailboxAccess.actorType, 'member'),
              eq(mailMailboxAccess.memberId, input.actor.memberId),
            )
          : and(
              eq(mailMailboxAccess.actorType, 'agent'),
              eq(mailMailboxAccess.agentId, input.actor.agentId),
            )
      const existingRows = yield* databaseEffect(
        'setMailboxAccess.findExisting',
        () =>
          tx
            .select()
            .from(mailMailboxAccess)
            .where(
              and(
                eq(mailMailboxAccess.workspaceId, input.workspaceId),
                eq(mailMailboxAccess.mailboxId, input.mailboxId),
                actorPredicate,
              ),
            )
            .limit(1),
      )
      const existing = existingRows[0]
      const rows =
        existing === undefined
          ? yield* databaseEffect('setMailboxAccess.insert', () =>
              tx
                .insert(mailMailboxAccess)
                .values({
                  workspaceId: input.workspaceId,
                  mailboxId: input.mailboxId,
                  actorType: actor.actorType,
                  memberId: actor.memberId,
                  agentId: actor.agentId,
                  accessLevel: input.accessLevel,
                })
                .returning(),
            )
          : yield* databaseEffect('setMailboxAccess.update', () =>
              tx
                .update(mailMailboxAccess)
                .set({ accessLevel: input.accessLevel, updatedAt: new Date() })
                .where(eq(mailMailboxAccess.id, existing.id))
                .returning(),
            )
      const row = rows[0]
      if (row === undefined) {
        return yield* new MailProvisioningPersistenceError({
          operation: 'setMailboxAccess',
          message: 'Mailbox access mutation returned no row.',
        })
      }
      return yield* decodeAccess(row, 'setMailboxAccess.decode')
    }),
  )
})
