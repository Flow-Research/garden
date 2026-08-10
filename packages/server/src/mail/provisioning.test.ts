import {
  AgentId,
  DomainName,
  LocalPart,
  MailActor,
  MailDomainId,
  MailboxAccessId,
  MailboxId,
  MemberId,
  WorkspaceId,
} from '@garden/core/mail'
import * as tables from '@garden/db/schema'
import { startTestDb, type TestDb } from '@garden/db/testing'
import { it } from '@effect/vitest'
import { afterAll, beforeAll, describe, expect } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { Effect, Layer } from 'effect'
import {
  MailDomainProvider,
  testMailDomainProviderLayer,
} from './domain-provider.ts'
import {
  CreateAdditionalMailAddressInput,
  MailProvisioning,
  type MailProvisioningService,
  MailProvisioningActorError,
  MailProvisioningConflictError,
  MailProvisioningNotFoundError,
  ProvisionMailboxInput,
  RegisterProvisionedDomainInput,
  makeMailProvisioningLayer,
} from './provisioning.ts'

const ids = {
  workspaceA: '20000000-0000-4000-8000-000000000001',
  workspaceB: '20000000-0000-4000-8000-000000000002',
  userA: '20000000-0000-4000-8000-000000000003',
  userB: '20000000-0000-4000-8000-000000000004',
  memberA: '20000000-0000-4000-8000-000000000005',
  memberB: '20000000-0000-4000-8000-000000000006',
  agentA: '20000000-0000-4000-8000-000000000007',
} as const

const workspaceA = WorkspaceId.make(ids.workspaceA)
const workspaceB = WorkspaceId.make(ids.workspaceB)
const memberA = MailActor.cases.Member.make({
  memberId: MemberId.make(ids.memberA),
})
const memberB = MailActor.cases.Member.make({
  memberId: MemberId.make(ids.memberB),
})
const agentA = MailActor.cases.Agent.make({
  agentId: AgentId.make(ids.agentA),
})

/** Seeds two workspaces so isolation failures can be exercised against real FKs. */
const seedWorkspaces = async (testDb: TestDb): Promise<void> => {
  await testDb.db.insert(tables.user).values([
    { id: ids.userA, email: 'provision-a@example.com', name: 'Provision A' },
    { id: ids.userB, email: 'provision-b@example.com', name: 'Provision B' },
  ])
  await testDb.db.insert(tables.organization).values([
    { id: ids.workspaceA, name: 'Provision A', slug: 'provision-a' },
    { id: ids.workspaceB, name: 'Provision B', slug: 'provision-b' },
  ])
  await testDb.db.insert(tables.member).values([
    {
      id: ids.memberA,
      organizationId: ids.workspaceA,
      userId: ids.userA,
      role: 'owner',
    },
    {
      id: ids.memberB,
      organizationId: ids.workspaceB,
      userId: ids.userB,
      role: 'owner',
    },
  ])
  await testDb.db.insert(tables.agent).values({
    id: ids.agentA,
    workspaceId: ids.workspaceA,
    ownerUserId: ids.userA,
    name: 'Mail Agent',
  })
}

/** Builds a fully wired application layer around the isolated Postgres client. */
const provisioningLayer = (testDb: TestDb) =>
  makeMailProvisioningLayer(testDb.db).pipe(
    Layer.provide(testMailDomainProviderLayer),
  )

interface ProviderCalls {
  registerSending: number
  inspectSending: number
  enableRouting: number
  inspectRouting: number
  setCatchAll: number
}

/** Records which provider operations retries use without weakening the fake. */
const recordingProviderLayer = (calls: ProviderCalls) =>
  Layer.effect(
    MailDomainProvider,
    Effect.gen(function* () {
      const provider = yield* MailDomainProvider
      return MailDomainProvider.of({
        ...provider,
        registerSendingSubdomain: (input) =>
          Effect.sync(() => {
            calls.registerSending += 1
          }).pipe(Effect.andThen(provider.registerSendingSubdomain(input))),
        inspectSendingSubdomain: (input) =>
          Effect.sync(() => {
            calls.inspectSending += 1
          }).pipe(Effect.andThen(provider.inspectSendingSubdomain(input))),
        enableEmailRouting: (input) =>
          Effect.sync(() => {
            calls.enableRouting += 1
          }).pipe(Effect.andThen(provider.enableEmailRouting(input))),
        inspectEmailRouting: (input) =>
          Effect.sync(() => {
            calls.inspectRouting += 1
          }).pipe(Effect.andThen(provider.inspectEmailRouting(input))),
        setCatchAllWorkerDelivery: (input) =>
          Effect.sync(() => {
            calls.setCatchAll += 1
          }).pipe(Effect.andThen(provider.setCatchAllWorkerDelivery(input))),
      })
    }),
  ).pipe(Layer.provide(testMailDomainProviderLayer))

/** Wires the application to a recording provider for retry assertions. */
const recordingProvisioningLayer = (testDb: TestDb, calls: ProviderCalls) =>
  makeMailProvisioningLayer(testDb.db).pipe(
    Layer.provide(recordingProviderLayer(calls)),
  )

/** Registers one complete fake-provider domain for a workspace. */
const registerDomain = (
  provisioning: MailProvisioningService,
  workspaceId: WorkspaceId,
  name: string,
) =>
  provisioning.registerDomain(
    RegisterProvisionedDomainInput.make({
      workspaceId,
      name: DomainName.make(name),
    }),
  )

describe('MailProvisioning (Postgres integration)', () => {
  let testDb: TestDb

  beforeAll(async () => {
    testDb = await startTestDb()
    await seedWorkspaces(testDb)
  })

  afterAll(async () => {
    await testDb?.cleanup()
  })

  it.effect(
    'checkpoints provider onboarding and refreshes workspace-owned state',
    () => {
      const calls: ProviderCalls = {
        registerSending: 0,
        inspectSending: 0,
        enableRouting: 0,
        inspectRouting: 0,
        setCatchAll: 0,
      }
      return Effect.gen(function* () {
        const provisioning = yield* MailProvisioning
        const registered = yield* registerDomain(
          provisioning,
          workspaceA,
          'investor-mail.test',
        )

        expect(registered).toMatchObject({
          workspaceId: workspaceA,
          name: 'investor-mail.test',
          status: 'active',
          transportProvider: 'test-mail-domain-provider',
          providerDomainId: 'test-sending-1',
        })
        expect(registered.verifiedAt).not.toBeNull()
        expect(registered.providerEvidence).toMatchObject({
          zoneId: 'zone-investor-mail.test',
          workerName: 'garden-mail-worker',
          sending: { enabled: true },
          routing: { enabled: true, status: 'ready' },
          catchAll: { enabled: true },
        })

        const registeredAgain = yield* registerDomain(
          provisioning,
          workspaceA,
          'investor-mail.test',
        )
        expect(registeredAgain.id).toBe(registered.id)
        expect(calls).toEqual({
          registerSending: 1,
          inspectSending: 1,
          enableRouting: 1,
          inspectRouting: 1,
          setCatchAll: 2,
        })

        const listedA = yield* provisioning.listDomains({
          workspaceId: workspaceA,
        })
        const listedB = yield* provisioning.listDomains({
          workspaceId: workspaceB,
        })
        expect(listedA.map((domain) => domain.id)).toContain(registered.id)
        expect(listedB).toEqual([])

        const refreshed = yield* provisioning.refreshDomain({
          workspaceId: workspaceA,
          domainId: MailDomainId.make(registered.id),
        })
        expect(refreshed.status).toBe('active')

        const hidden = yield* provisioning
          .refreshDomain({
            workspaceId: workspaceB,
            domainId: MailDomainId.make(registered.id),
          })
          .pipe(Effect.flip)
        expect(hidden).toBeInstanceOf(MailProvisioningNotFoundError)

        const conflict = yield* registerDomain(
          provisioning,
          workspaceB,
          'investor-mail.test',
        ).pipe(Effect.flip)
        expect(conflict).toBeInstanceOf(MailProvisioningConflictError)

        const rows = yield* Effect.tryPromise(() =>
          testDb.db
            .select()
            .from(tables.mailDomain)
            .where(eq(tables.mailDomain.id, registered.id)),
        )
        expect(rows).toHaveLength(1)
        expect(rows[0]?.providerEvidence).toMatchObject({
          sending: { enabled: true },
          routing: { status: 'ready' },
          catchAll: { enabled: true },
        })
      }).pipe(Effect.provide(recordingProvisioningLayer(testDb, calls)))
    },
  )

  it.effect(
    'atomically creates mailbox ownership, aliases, catch-all, and access',
    () =>
      Effect.gen(function* () {
        const provisioning = yield* MailProvisioning
        const domain = yield* registerDomain(
          provisioning,
          workspaceA,
          'collaboration-mail.test',
        )
        const mailbox = yield* provisioning.createMailbox(
          ProvisionMailboxInput.make({
            workspaceId: workspaceA,
            domainId: MailDomainId.make(domain.id),
            name: 'Investor Relations',
            kind: 'shared',
            primaryLocalPart: LocalPart.make('investors'),
            owner: memberA,
          }),
        )

        expect(mailbox.mailbox).toMatchObject({
          workspaceId: workspaceA,
          name: 'Investor Relations',
          kind: 'shared',
        })
        expect(mailbox.primaryAddress).toMatchObject({
          domainId: domain.id,
          mailboxId: mailbox.mailbox.id,
          localPart: 'investors',
          kind: 'primary',
        })
        expect(mailbox.ownerAccess).toMatchObject({
          actor: memberA,
          accessLevel: 'owner',
        })

        const aliasInput = CreateAdditionalMailAddressInput.cases.Alias.make({
          workspaceId: workspaceA,
          domainId: MailDomainId.make(domain.id),
          mailboxId: MailboxId.make(mailbox.mailbox.id),
          localPart: LocalPart.make('ir'),
        })
        const alias = yield* provisioning.createAddress(aliasInput)
        const aliasAgain = yield* provisioning.createAddress(aliasInput)
        expect(aliasAgain.id).toBe(alias.id)

        const catchAll = yield* provisioning.createAddress(
          CreateAdditionalMailAddressInput.cases.CatchAll.make({
            workspaceId: workspaceA,
            domainId: MailDomainId.make(domain.id),
            mailboxId: MailboxId.make(mailbox.mailbox.id),
          }),
        )
        expect(catchAll).toMatchObject({ localPart: '*', kind: 'catch_all' })

        const granted = yield* provisioning.setMailboxAccess({
          workspaceId: workspaceA,
          mailboxId: MailboxId.make(mailbox.mailbox.id),
          actor: agentA,
          accessLevel: 'editor',
        })
        const updated = yield* provisioning.setMailboxAccess({
          workspaceId: workspaceA,
          mailboxId: MailboxId.make(mailbox.mailbox.id),
          actor: agentA,
          accessLevel: 'viewer',
        })
        expect(updated.id).toBe(granted.id)
        expect(updated.accessLevel).toBe('viewer')

        const finalOwnerRemoval = yield* provisioning
          .removeMailboxAccess({
            workspaceId: workspaceA,
            accessId: MailboxAccessId.make(mailbox.ownerAccess.id),
          })
          .pipe(Effect.flip)
        expect(finalOwnerRemoval).toBeInstanceOf(MailProvisioningConflictError)

        yield* provisioning.setMailboxAccess({
          workspaceId: workspaceA,
          mailboxId: MailboxId.make(mailbox.mailbox.id),
          actor: agentA,
          accessLevel: 'owner',
        })
        yield* provisioning.removeMailboxAccess({
          workspaceId: workspaceA,
          accessId: MailboxAccessId.make(mailbox.ownerAccess.id),
        })

        const finalOwnerDowngrade = yield* provisioning
          .setMailboxAccess({
            workspaceId: workspaceA,
            mailboxId: MailboxId.make(mailbox.mailbox.id),
            actor: agentA,
            accessLevel: 'viewer',
          })
          .pipe(Effect.flip)
        expect(finalOwnerDowngrade).toBeInstanceOf(
          MailProvisioningConflictError,
        )

        const rows = yield* Effect.tryPromise(() =>
          Promise.all([
            testDb.db
              .select()
              .from(tables.mailMailbox)
              .where(eq(tables.mailMailbox.id, mailbox.mailbox.id)),
            testDb.db
              .select()
              .from(tables.mailAddress)
              .where(eq(tables.mailAddress.mailboxId, mailbox.mailbox.id)),
            testDb.db
              .select()
              .from(tables.mailMailboxAccess)
              .where(
                eq(tables.mailMailboxAccess.mailboxId, mailbox.mailbox.id),
              ),
          ]),
        )
        expect(rows[0]).toHaveLength(1)
        expect(rows[1]).toHaveLength(3)
        expect(rows[2]).toHaveLength(1)
        expect(rows[2]?.[0]?.accessLevel).toBe('owner')
      }).pipe(Effect.provide(provisioningLayer(testDb))),
  )

  it.effect('rolls back invalid cross-workspace mailbox mutations', () =>
    Effect.gen(function* () {
      const provisioning = yield* MailProvisioning
      const domain = yield* registerDomain(
        provisioning,
        workspaceA,
        'isolated-mail.test',
      )

      const before = yield* Effect.tryPromise(() =>
        testDb.db
          .select({ id: tables.mailMailbox.id })
          .from(tables.mailMailbox)
          .where(eq(tables.mailMailbox.workspaceId, ids.workspaceA)),
      )
      const invalidOwner = yield* provisioning
        .createMailbox(
          ProvisionMailboxInput.make({
            workspaceId: workspaceA,
            domainId: MailDomainId.make(domain.id),
            name: 'Invalid owner',
            kind: 'shared',
            primaryLocalPart: LocalPart.make('invalid-owner'),
            owner: memberB,
          }),
        )
        .pipe(Effect.flip)
      expect(invalidOwner).toBeInstanceOf(MailProvisioningActorError)

      const after = yield* Effect.tryPromise(() =>
        testDb.db
          .select({ id: tables.mailMailbox.id })
          .from(tables.mailMailbox)
          .where(eq(tables.mailMailbox.workspaceId, ids.workspaceA)),
      )
      expect(after).toHaveLength(before.length)

      const ownMailbox = yield* provisioning.createMailbox(
        ProvisionMailboxInput.make({
          workspaceId: workspaceA,
          domainId: MailDomainId.make(domain.id),
          name: 'Workspace A',
          kind: 'shared',
          primaryLocalPart: LocalPart.make('workspace-a'),
          owner: memberA,
        }),
      )
      const hiddenLink = yield* provisioning
        .createAddress(
          CreateAdditionalMailAddressInput.cases.Alias.make({
            workspaceId: workspaceB,
            domainId: MailDomainId.make(domain.id),
            mailboxId: MailboxId.make(ownMailbox.mailbox.id),
            localPart: LocalPart.make('cross-workspace'),
          }),
        )
        .pipe(Effect.flip)
      expect(hiddenLink).toBeInstanceOf(MailProvisioningNotFoundError)

      const leakedAddress = yield* Effect.tryPromise(() =>
        testDb.db
          .select()
          .from(tables.mailAddress)
          .where(
            and(
              eq(tables.mailAddress.domainId, domain.id),
              eq(tables.mailAddress.localPart, 'cross-workspace'),
            ),
          ),
      )
      expect(leakedAddress).toEqual([])
    }).pipe(Effect.provide(provisioningLayer(testDb))),
  )
})
