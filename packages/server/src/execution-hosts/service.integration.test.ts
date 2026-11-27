import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startTestDb, type TestDb } from '@garden/db/testing'
import * as schema from '@garden/db/schema'
import {
  hostContractVersion,
  type HostEnrollment,
  type HostEvent,
  type HostLaunch,
  type HostRequestUnsigned,
} from '@garden/core/execution-host/contracts'
import { signHostRequest } from '@garden/core/execution-host/auth'
import { ExecutionHostReceiver, executionControlDigest } from './service'

describe('external host receiver with actual PostgreSQL', () => {
  let database: TestDb
  beforeAll(async () => {
    database = await startTestDb()
  }, 120_000)
  afterAll(async () => {
    await database?.cleanup()
  })

  async function fixture() {
    const userId = randomUUID(),
      workspaceId = randomUUID()
    await database.db.insert(schema.user).values({
      id: userId,
      email: `${userId}@example.test`,
      name: 'Pilot fixture',
    })
    await database.db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Host fixture',
      slug: `host-${workspaceId}`,
    })
    await database.db
      .insert(schema.member)
      .values({ organizationId: workspaceId, userId, role: 'owner' })
    const sessionId = randomUUID()
    await database.db.insert(schema.session).values({
      id: sessionId,
      userId,
      token: randomUUID(),
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    })
    let clock = 1_000_000
    const receiver = new ExecutionHostReceiver(
      database.db,
      userId,
      sessionId,
      () => clock,
    )
    const addHost = async () => {
      const keys = await crypto.subtle.generateKey('Ed25519', true, [
        'sign',
        'verify',
      ])
      if (!('privateKey' in keys))
        throw new Error('Expected fixture Ed25519 key pair')
      const enrollment: HostEnrollment = {
        contractVersion: hostContractVersion,
        hostId: randomUUID(),
        workspaceId,
        operatorId: userId,
        publicKey: Buffer.from(
          await crypto.subtle.exportKey('raw', keys.publicKey),
        ).toString('base64url'),
        keyGeneration: 1,
        repositories: ['garden'],
        agent: 'claude-code',
        capabilityDigest: 'a'.repeat(64),
      }
      const enrolled = await receiver.enroll(userId, enrollment)
      expect(enrolled.isOk(), JSON.stringify(enrolled)).toBe(true)
      const send = async (body: HostRequestUnsigned['body']) => {
        const request = await signHostRequest(
          {
            contractVersion: hostContractVersion,
            hostId: enrollment.hostId,
            workspaceId,
            keyGeneration: 1,
            nonce: randomUUID(),
            signedAt: clock,
            body,
          },
          keys.privateKey,
        )
        return receiver.receive(request, clock)
      }
      const launch = async () => {
        const job: HostLaunch['job'] = {
          schema: 'harnessy.engineering.job.v1',
          id: randomUUID(),
          objective: 'native-controls',
          taskId: randomUUID(),
          taskRevision: 'f'.repeat(64),
          workspace: workspaceId,
          repository: 'garden',
          lane: 'native',
          sourceRevision: 'b'.repeat(40),
          evaluatorDigest: 'c'.repeat(64),
          workloadDigest: 'd'.repeat(64),
        }
        const unsigned = {
          contractVersion: hostContractVersion,
          launchId: randomUUID(),
          hostId: enrollment.hostId,
          workspaceId,
          memberId: userId,
          operatorId: userId,
          capabilityDigest: enrollment.capabilityDigest,
          job,
          grant: {
            schema: 'harnessy.engineering.grant.v1' as const,
            id: randomUUID(),
            operator: 'julian' as const,
            jobDigest: await executionControlDigest(job),
            issuedAt: clock,
            expiresAt: clock + 135 * 60_000,
          },
        }
        const launch: HostLaunch = {
          ...unsigned,
          requestDigest: await executionControlDigest(unsigned),
        }
        expect((await receiver.launch(userId, launch, clock)).isOk()).toBe(true)
        return launch
      }
      return { enrollment, keys, send, launch }
    }
    return {
      receiver,
      userId,
      workspaceId,
      sessionId,
      addHost,
      now: () => clock,
      advance: () => {
        clock++
      },
      setClock: (value: number) => {
        clock = value
      },
    }
  }

  it('enforces the same 24-hour grant ceiling as the host approval command', async () => {
    const state = await fixture()
    const host = await state.addHost()
    const original = await host.launch()
    const { requestDigest: _digest, ...binding } = original
    const grant = {
      ...original.grant,
      expiresAt: original.grant.issuedAt + 24 * 60 * 60_000 + 1,
    }
    const unsigned = { ...binding, launchId: randomUUID(), grant }
    const denied = await state.receiver.launch(
      state.userId,
      { ...unsigned, requestDigest: await executionControlDigest(unsigned) },
      state.now(),
    )
    expect(denied.isErr() && denied.error.status).toBe(400)
  })

  it('retains one launch after a lost acknowledgment and rejects changed input or replay', async () => {
    const fixtureState = await fixture()
    const { receiver, userId } = fixtureState
    const host = await fixtureState.addHost()
    const launch = await host.launch()
    expect(
      (await receiver.launch(userId, launch, fixtureState.now())).isOk(),
    ).toBe(true)
    const changed = {
      ...launch,
      job: { ...launch.job, taskRevision: 'e'.repeat(64) },
    }
    expect(
      (await receiver.launch(userId, changed, fixtureState.now())).isErr(),
    ).toBe(true)
    const first = await host.send({ operation: 'pull', afterSequence: 0 })
    const second = await host.send({ operation: 'pull', afterSequence: 0 })
    expect(first.unwrap()).toMatchObject({
      kind: 'commands',
      commands: [{ kind: 'launch', launch: { launchId: launch.launchId } }],
    })
    expect(second.unwrap()).toEqual(first.unwrap())
    const request = await signHostRequest(
      {
        contractVersion: hostContractVersion,
        hostId: host.enrollment.hostId,
        workspaceId: fixtureState.workspaceId,
        keyGeneration: 1,
        nonce: randomUUID(),
        signedAt: fixtureState.now(),
        body: { operation: 'pull', afterSequence: 0 },
      },
      host.keys.privateKey,
    )
    expect((await receiver.receive(request, fixtureState.now())).isOk()).toBe(
      true,
    )
    expect((await receiver.receive(request, fixtureState.now())).isErr()).toBe(
      true,
    )
    const rows = await database.db
      .select()
      .from(schema.executionHostLaunch)
      .where(
        eq(schema.executionHostLaunch.workspaceId, fixtureState.workspaceId),
      )
    expect(rows).toHaveLength(1)
  })

  it('serializes two enrolled machines into one operator execution slot', async () => {
    const state = await fixture()
    const first = await state.addHost(),
      second = await state.addHost()
    const firstLaunch = await first.launch(),
      secondLaunch = await second.launch()
    const delivered = await Promise.all([
      first.send({ operation: 'pull', afterSequence: 0 }),
      second.send({ operation: 'pull', afterSequence: 0 }),
    ])
    const counts = delivered.map((result) => {
      const value = result.unwrap()
      return value.kind === 'commands' ? value.commands.length : -1
    })
    expect([...counts].sort()).toEqual([0, 1])
    const winner = counts[0] === 1 ? first : second,
      loser = counts[0] === 1 ? second : first
    const launch = counts[0] === 1 ? firstLaunch : secondLaunch
    expect(
      (
        await winner.send({
          operation: 'acknowledge',
          launchId: launch.launchId,
          requestDigest: launch.requestDigest,
          runId: launch.launchId,
        })
      ).isOk(),
    ).toBe(true)
    expect(
      (await loser.send({ operation: 'pull', afterSequence: 0 })).unwrap(),
    ).toMatchObject({ kind: 'commands', commands: [] })
    const terminal = {
      contractVersion: hostContractVersion,
      hostId: winner.enrollment.hostId,
      workspaceId: state.workspaceId,
      launchId: launch.launchId,
      runId: launch.launchId,
      sequence: 1,
      at: state.now(),
      state: 'cancelled' as const,
      reason: 'termination_confirmed' as const,
      sourceRevision: launch.job.sourceRevision,
    }
    expect(
      (await winner.send({ operation: 'event', event: terminal })).isErr(),
    ).toBe(true)
    expect(
      (
        await winner.send({
          operation: 'event',
          event: { ...terminal, evidenceDigest: 'e'.repeat(64) },
        })
      ).isOk(),
    ).toBe(true)
    const next = (
      await loser.send({ operation: 'pull', afterSequence: 0 })
    ).unwrap()
    expect(next.kind === 'commands' && next.commands.length).toBe(1)
  })

  it('binds acknowledgment and event identity, preserves duplicate events and refuses gaps', async () => {
    const state = await fixture()
    const host = await state.addHost()
    const launch = await host.launch()
    await host.send({ operation: 'pull', afterSequence: 0 })
    const ack = {
      operation: 'acknowledge' as const,
      launchId: launch.launchId,
      requestDigest: launch.requestDigest,
      runId: launch.launchId,
    }
    expect((await host.send(ack)).isOk()).toBe(true)
    expect((await host.send(ack)).isOk()).toBe(true)
    expect((await host.send({ ...ack, runId: randomUUID() })).isErr()).toBe(
      true,
    )
    const event = {
      contractVersion: hostContractVersion,
      hostId: host.enrollment.hostId,
      workspaceId: state.workspaceId,
      launchId: launch.launchId,
      runId: launch.launchId,
      sequence: 1,
      at: state.now(),
      state: 'running' as const,
      reason: 'worker_active' as const,
      sourceRevision: launch.job.sourceRevision,
    }
    expect(
      (
        await host.send({
          operation: 'event',
          event: { ...event, sequence: 2 },
        })
      ).isErr(),
    ).toBe(true)
    expect((await host.send({ operation: 'event', event })).isOk()).toBe(true)
    state.advance()
    expect(
      (
        await host.send({
          operation: 'event',
          event: {
            ...event,
            at: state.now(),
            sequence: 2,
            state: 'verifying',
            reason: 'verifying',
          },
        })
      ).isOk(),
    ).toBe(true)
    expect((await host.send({ operation: 'event', event })).isOk()).toBe(true)
    expect(
      (
        await host.send({
          operation: 'event',
          event: { ...event, reason: 'launching' },
        })
      ).isErr(),
    ).toBe(true)
    const snapshot = (
      await state.receiver.snapshot(
        state.userId,
        state.workspaceId,
        launch.launchId,
        1,
      )
    ).unwrap()
    expect(snapshot.lastSequence).toBe(2)
    expect(snapshot.events.map((event) => event.sequence)).toEqual([2])
  })

  it('refuses membership loss and host revocation despite valid signed requests', async () => {
    const state = await fixture()
    const host = await state.addHost()
    await host.launch()
    await database.db
      .delete(schema.member)
      .where(
        and(
          eq(schema.member.userId, state.userId),
          eq(schema.member.organizationId, state.workspaceId),
        ),
      )
    expect(
      (await host.send({ operation: 'pull', afterSequence: 0 })).isErr(),
    ).toBe(true)
    await database.db.insert(schema.member).values({
      userId: state.userId,
      organizationId: state.workspaceId,
      role: 'owner',
    })
    expect(
      (
        await state.receiver.revoke(
          state.userId,
          state.workspaceId,
          host.enrollment.hostId,
          state.now(),
        )
      ).isOk(),
    ).toBe(true)
    expect(
      (await host.send({ operation: 'pull', afterSequence: 0 })).isErr(),
    ).toBe(true)
    expect(
      (await state.receiver.enroll(state.userId, host.enrollment)).isErr(),
    ).toBe(true)
  })

  it('records cancellation separately from process termination and binds offline reads to current authority', async () => {
    const state = await fixture()
    const host = await state.addHost()
    const launch = await host.launch()
    await host.send({ operation: 'pull', afterSequence: 0 })
    await host.send({
      operation: 'acknowledge',
      launchId: launch.launchId,
      requestDigest: launch.requestDigest,
      runId: launch.launchId,
    })
    const commandId = randomUUID()
    expect(
      (
        await state.receiver.cancel(
          state.userId,
          state.workspaceId,
          launch.launchId,
          commandId,
          state.now(),
        )
      ).unwrap(),
    ).toMatchObject({
      kind: 'cancellation_received',
      termination: 'unconfirmed',
      commandId,
    })
    expect(
      (await host.send({ operation: 'pull', afterSequence: 0 })).unwrap(),
    ).toMatchObject({
      kind: 'commands',
      commands: [
        { kind: 'cancel', command: { commandId, runId: launch.launchId } },
      ],
    })
    expect(
      (
        await state.receiver.snapshot(
          randomUUID(),
          state.workspaceId,
          launch.launchId,
        )
      ).isErr(),
    ).toBe(true)
    expect(
      (
        await state.receiver.snapshot(
          state.userId,
          randomUUID(),
          launch.launchId,
        )
      ).isErr(),
    ).toBe(true)
    const rows = await database.db
      .select()
      .from(schema.executionHostCapacity)
      .where(eq(schema.executionHostCapacity.operatorId, state.userId))
    expect(rows[0]?.launchRecordId).not.toBeNull()
  })

  it('requires a live member session for effects while preserving independent signed host authority', async () => {
    const state = await fixture()
    const host = await state.addHost()
    const launch = await host.launch()
    await host.send({ operation: 'pull', afterSequence: 0 })
    await host.send({
      operation: 'acknowledge',
      launchId: launch.launchId,
      requestDigest: launch.requestDigest,
      runId: launch.launchId,
    })
    await database.db
      .delete(schema.session)
      .where(eq(schema.session.id, state.sessionId))
    const cancelled = await state.receiver.cancel(
      state.userId,
      state.workspaceId,
      launch.launchId,
      randomUUID(),
      state.now(),
    )
    expect(cancelled.isErr() && cancelled.error.status).toBe(401)
    const snapshot = await state.receiver.snapshot(
      state.userId,
      state.workspaceId,
      launch.launchId,
    )
    expect(snapshot.isErr() && snapshot.error.status).toBe(401)
    expect(
      (
        await host.send({
          operation: 'authority',
          launchId: launch.launchId,
          grantId: launch.grant.id,
        })
      ).unwrap(),
    ).toMatchObject({ kind: 'authority_current', launchId: launch.launchId })
    const anonymous = new ExecutionHostReceiver(database.db, state.userId)
    const denied = await anonymous.enroll(state.userId, host.enrollment)
    expect(denied.isErr() && denied.error.status).toBe(401)
  })

  it('refuses an expired or foreign session at the transaction boundary', async () => {
    const state = await fixture()
    const host = await state.addHost()
    await database.db
      .update(schema.session)
      .set({ expiresAt: new Date('2000-01-01T00:00:00Z') })
      .where(eq(schema.session.id, state.sessionId))
    expect(
      (await state.receiver.enroll(state.userId, host.enrollment)).isErr(),
    ).toBe(true)
    const other = await fixture()
    const foreign = new ExecutionHostReceiver(
      database.db,
      state.userId,
      other.sessionId,
    )
    const result = await foreign.enroll(state.userId, host.enrollment)
    expect(result.isErr() && result.error.status).toBe(401)
  })

  it('refuses new authority after cancellation and preserves duplicate acknowledgment after terminal capacity release', async () => {
    const state = await fixture()
    const host = await state.addHost()
    const launch = await host.launch()
    await host.send({ operation: 'pull', afterSequence: 0 })
    const ack = {
      operation: 'acknowledge' as const,
      launchId: launch.launchId,
      runId: launch.launchId,
      requestDigest: launch.requestDigest,
    }
    expect((await host.send(ack)).isOk()).toBe(true)
    expect(
      (
        await host.send({
          operation: 'authority',
          launchId: launch.launchId,
          grantId: launch.grant.id,
        })
      ).unwrap(),
    ).toMatchObject({ kind: 'authority_current' })
    await state.receiver.cancel(
      state.userId,
      state.workspaceId,
      launch.launchId,
      randomUUID(),
      state.now(),
    )
    expect(
      (
        await host.send({
          operation: 'authority',
          launchId: launch.launchId,
          grantId: launch.grant.id,
        })
      ).unwrap(),
    ).toEqual({ kind: 'authority_refused', reason: 'cancellation_requested' })
    const event: HostEvent = {
      contractVersion: hostContractVersion,
      hostId: host.enrollment.hostId,
      workspaceId: state.workspaceId,
      launchId: launch.launchId,
      runId: launch.launchId,
      sequence: 1,
      at: state.now(),
      state: 'cancelled',
      reason: 'termination_confirmed',
      sourceRevision: launch.job.sourceRevision,
      evidenceDigest: 'e'.repeat(64),
    }
    expect((await host.send({ operation: 'event', event })).isOk()).toBe(true)
    expect((await host.send(ack)).unwrap()).toEqual({
      kind: 'acknowledged',
      launchId: launch.launchId,
      runId: launch.launchId,
    })
    const capacity = await database.db
      .select()
      .from(schema.executionHostCapacity)
      .where(eq(schema.executionHostCapacity.operatorId, state.userId))
    expect(capacity[0]?.launchRecordId).toBeNull()
    const next = await host.launch()
    await host.send({ operation: 'pull', afterSequence: 0 })
    await host.send({
      operation: 'acknowledge',
      launchId: next.launchId,
      runId: next.launchId,
      requestDigest: next.requestDigest,
    })
    expect(
      (
        await host.send({
          operation: 'event',
          event: {
            ...event,
            launchId: next.launchId,
            runId: next.launchId,
            state: 'succeeded',
            reason: 'verified',
          },
        })
      ).isOk(),
    ).toBe(true)
    expect(
      (
        await host.send({
          operation: 'authority',
          launchId: next.launchId,
          grantId: next.grant.id,
        })
      ).unwrap(),
    ).toEqual({ kind: 'authority_refused', reason: 'terminal' })
  })

  it('cancels an undelivered launch without creating a worker or occupying capacity', async () => {
    const state = await fixture()
    const host = await state.addHost()
    const launch = await host.launch()
    const commandId = randomUUID()
    const first = await state.receiver.cancel(
      state.userId,
      state.workspaceId,
      launch.launchId,
      commandId,
      state.now(),
    )
    expect(first.unwrap()).toEqual({
      kind: 'cancelled_before_dispatch',
      commandId,
      launchId: launch.launchId,
      termination: 'not-started',
    })
    expect(
      (
        await state.receiver.cancel(
          state.userId,
          state.workspaceId,
          launch.launchId,
          randomUUID(),
          state.now(),
        )
      ).unwrap(),
    ).toEqual(first.unwrap())
    expect(
      (await host.send({ operation: 'pull', afterSequence: 0 })).unwrap(),
    ).toEqual({ kind: 'commands', commands: [] })
    expect(
      (
        await state.receiver.snapshot(
          state.userId,
          state.workspaceId,
          launch.launchId,
        )
      ).unwrap(),
    ).toMatchObject({ termination: 'not-started', runId: null })
  })

  it('rejects foreign event scope, unsupported terminal reasons, and receiver clock rollback', async () => {
    const state = await fixture()
    const host = await state.addHost()
    const launch = await host.launch()
    await host.send({ operation: 'pull', afterSequence: 0 })
    await host.send({
      operation: 'acknowledge',
      launchId: launch.launchId,
      runId: launch.launchId,
      requestDigest: launch.requestDigest,
    })
    const event: HostEvent = {
      contractVersion: hostContractVersion,
      hostId: host.enrollment.hostId,
      workspaceId: state.workspaceId,
      launchId: launch.launchId,
      runId: launch.launchId,
      sequence: 1,
      at: state.now(),
      state: 'succeeded',
      reason: 'verified',
      sourceRevision: launch.job.sourceRevision,
      evidenceDigest: 'e'.repeat(64),
    }
    for (const changed of [
      { ...event, hostId: randomUUID() },
      { ...event, workspaceId: randomUUID() },
      { ...event, reason: 'worker_active' as const },
    ])
      expect(
        (await host.send({ operation: 'event', event: changed })).isErr(),
      ).toBe(true)
    const request = await signHostRequest(
      {
        contractVersion: hostContractVersion,
        hostId: host.enrollment.hostId,
        workspaceId: state.workspaceId,
        keyGeneration: 1,
        nonce: randomUUID(),
        signedAt: state.now() - 1,
        body: { operation: 'pull', afterSequence: 0 },
      },
      host.keys.privateKey,
    )
    const earlier = state.now() - 1
    state.setClock(earlier)
    const regressed = await state.receiver.receive(request, earlier)
    state.advance()
    expect(regressed.isErr() && regressed.error.message).toBe(
      'Receiver clock regressed',
    )
    expect((await host.send({ operation: 'event', event })).isOk()).toBe(true)
  })

  it('refuses narrowed enrollment for queued delivery and an existing grant', async () => {
    const state = await fixture()
    const host = await state.addHost()
    const launch = await host.launch()
    await host.send({ operation: 'pull', afterSequence: 0 })
    await host.send({
      operation: 'acknowledge',
      launchId: launch.launchId,
      runId: launch.launchId,
      requestDigest: launch.requestDigest,
    })
    await database.db
      .update(schema.executionHost)
      .set({ enrollment: { ...host.enrollment, repositories: ['workstream'] } })
      .where(eq(schema.executionHost.id, host.enrollment.hostId))
    expect(
      (
        await host.send({
          operation: 'authority',
          launchId: launch.launchId,
          grantId: launch.grant.id,
        })
      ).unwrap(),
    ).toEqual({ kind: 'authority_refused', reason: 'capability_changed' })
    const other = await fixture()
    const queuedHost = await other.addHost()
    await queuedHost.launch()
    await database.db
      .update(schema.executionHost)
      .set({
        enrollment: {
          ...queuedHost.enrollment,
          capabilityDigest: 'f'.repeat(64),
        },
      })
      .where(eq(schema.executionHost.id, queuedHost.enrollment.hostId))
    expect(
      (await queuedHost.send({ operation: 'pull', afterSequence: 0 })).unwrap(),
    ).toEqual({ kind: 'commands', commands: [] })
  })

  it('returns a conflict for concurrent cross-host reuse of a launch identity', async () => {
    const state = await fixture()
    const first = await state.addHost()
    const second = await state.addHost()
    const original = await first.launch()
    const { requestDigest: _requestDigest, ...fields } = original
    const unsigned = { ...fields, launchId: randomUUID() }
    const contender = { ...unsigned, hostId: second.enrollment.hostId }
    const results = await Promise.all([
      state.receiver.launch(
        state.userId,
        { ...unsigned, requestDigest: await executionControlDigest(unsigned) },
        state.now(),
      ),
      state.receiver.launch(
        state.userId,
        {
          ...contender,
          requestDigest: await executionControlDigest(contender),
        },
        state.now(),
      ),
    ])
    expect(results.filter((result) => result.isOk())).toHaveLength(1)
    expect(
      results.flatMap((result) =>
        result.isErr() ? [result.error.status] : [],
      ),
    ).toEqual([409])
  })

  it('returns every event across bounded pages without confusing the page cursor with the event head', async () => {
    const state = await fixture()
    const host = await state.addHost()
    const launch = await host.launch()
    await host.send({ operation: 'pull', afterSequence: 0 })
    await host.send({
      operation: 'acknowledge',
      launchId: launch.launchId,
      runId: launch.launchId,
      requestDigest: launch.requestDigest,
    })
    const rows = await database.db
      .select()
      .from(schema.executionHostLaunch)
      .where(eq(schema.executionHostLaunch.launchId, launch.launchId))
    const row = rows[0]
    if (!row) throw new Error('Missing test launch')
    // Seed retained events to exercise paging independently of event admission.
    const events = Array.from(
      { length: 201 },
      (_, index): HostEvent => ({
        contractVersion: hostContractVersion,
        hostId: host.enrollment.hostId,
        workspaceId: state.workspaceId,
        launchId: launch.launchId,
        runId: launch.launchId,
        sequence: index + 1,
        at: state.now(),
        state: 'running',
        reason: 'worker_active',
        sourceRevision: launch.job.sourceRevision,
      }),
    )
    await database.db.insert(schema.executionHostEvent).values(
      await Promise.all(
        events.map(async (event) => ({
          launchRecordId: row.id,
          sequence: event.sequence,
          digest: await executionControlDigest(event),
          event,
        })),
      ),
    )
    await database.db
      .update(schema.executionHostLaunch)
      .set({ lastEventSequence: 201, lastEventAt: new Date(state.now()) })
      .where(eq(schema.executionHostLaunch.id, row.id))
    const first = (
      await state.receiver.snapshot(
        state.userId,
        state.workspaceId,
        launch.launchId,
      )
    ).unwrap()
    expect(first.events).toHaveLength(200)
    expect(first.nextCursor).toBe(200)
    expect(first.latestEvent?.sequence).toBe(201)
    const next = (
      await state.receiver.snapshot(
        state.userId,
        state.workspaceId,
        launch.launchId,
        first.nextCursor,
      )
    ).unwrap()
    expect(next.events.map((event) => event.sequence)).toEqual([201])
    expect(next.nextCursor).toBe(201)
  })

  it('returns current delivery receipts on retry instead of inventing a pending state', async () => {
    const state = await fixture()
    const host = await state.addHost()
    const launch = await host.launch()
    expect(
      (await state.receiver.launch(state.userId, launch, state.now())).unwrap(),
    ).toMatchObject({
      kind: 'launch_receipt',
      deliveryStatus: 'pending',
      runId: null,
      termination: 'unconfirmed',
    })
    await host.send({ operation: 'pull', afterSequence: 0 })
    await host.send({
      operation: 'acknowledge',
      launchId: launch.launchId,
      runId: launch.launchId,
      requestDigest: launch.requestDigest,
    })
    expect(
      (await state.receiver.launch(state.userId, launch, state.now())).unwrap(),
    ).toMatchObject({
      kind: 'launch_receipt',
      deliveryStatus: 'acknowledged',
      runId: launch.launchId,
    })
    const snapshot = (
      await state.receiver.snapshot(
        state.userId,
        state.workspaceId,
        launch.launchId,
      )
    ).unwrap()
    expect(snapshot).toMatchObject({
      workspaceId: state.workspaceId,
      job: launch.job,
      hasMore: false,
      host: {
        hostId: host.enrollment.hostId,
        lastSeenAt: state.now(),
        status: 'enrolled',
      },
    })
  })

  it('discovers only current workspace hosts with bounded pages and no process or credential fields', async () => {
    const state = await fixture()
    const host = await state.addHost()
    const enrolled = Array.from({ length: 100 }, () => ({
      id: randomUUID(),
      workspaceId: state.workspaceId,
      operatorId: state.userId,
      enrollment: { ...host.enrollment, hostId: randomUUID() },
      keyGeneration: 1,
    }))
    for (const row of enrolled) row.enrollment.hostId = row.id
    await database.db.insert(schema.executionHost).values(enrolled)
    const first = (
      await state.receiver.directory(
        state.userId,
        state.workspaceId,
        state.now(),
      )
    ).unwrap()
    expect(first.hosts).toHaveLength(100)
    expect(first.nextHostId).not.toBeNull()
    const cursor = first.nextHostId
    if (cursor === null) throw new Error('Missing next host cursor')
    const next = (
      await state.receiver.directory(
        state.userId,
        state.workspaceId,
        state.now(),
        cursor,
      )
    ).unwrap()
    expect(next.hosts).toHaveLength(1)
    expect(next.nextHostId).toBeNull()
    expect(
      new Set([...first.hosts, ...next.hosts].map((entry) => entry.hostId))
        .size,
    ).toBe(101)
    expect(
      first.hosts.every((entry) => entry.workspaceId === state.workspaceId),
    ).toBe(true)
    expect(JSON.stringify(first)).not.toContain('publicKey')
    expect(JSON.stringify(first)).not.toContain('privateKey')
    expect(
      (
        await state.receiver.directory(state.userId, randomUUID(), state.now())
      ).isErr(),
    ).toBe(true)
    expect(
      (
        await state.receiver.directory(
          state.userId,
          state.workspaceId,
          state.now(),
          'invalid',
        )
      ).isErr(),
    ).toBe(true)
  })

  it('settles a signed decline before start once, preserving a lost-reply retry and releasing only its reservation', async () => {
    const state = await fixture()
    const host = await state.addHost()
    const launch = await host.launch()
    const decline = {
      operation: 'decline' as const,
      launchId: launch.launchId,
      requestDigest: launch.requestDigest,
      declineId: randomUUID(),
      reason: 'allowance_unavailable' as const,
    }
    expect((await host.send(decline)).isErr()).toBe(true)
    await host.send({ operation: 'pull', afterSequence: 0 })
    const first = (await host.send(decline)).unwrap()
    expect(first).toEqual({
      kind: 'declined',
      launchId: launch.launchId,
      requestDigest: launch.requestDigest,
      declineId: decline.declineId,
      reason: decline.reason,
      termination: 'not-started',
    })
    expect((await host.send(decline)).unwrap()).toEqual(first)
    expect(
      (await host.send({ ...decline, declineId: randomUUID() })).isErr(),
    ).toBe(true)
    expect(
      (
        await host.send({
          operation: 'acknowledge',
          launchId: launch.launchId,
          requestDigest: launch.requestDigest,
          runId: launch.launchId,
        })
      ).isErr(),
    ).toBe(true)
    const snapshot = (
      await state.receiver.snapshot(
        state.userId,
        state.workspaceId,
        launch.launchId,
      )
    ).unwrap()
    expect(snapshot).toMatchObject({
      termination: 'not-started',
      deliveryStatus: 'revoked',
      runId: null,
      lastSequence: 0,
    })
    const next = await host.launch()
    expect(
      (await host.send({ operation: 'pull', afterSequence: 0 })).unwrap(),
    ).toMatchObject({
      kind: 'commands',
      commands: [{ kind: 'launch', launch: { launchId: next.launchId } }],
    })
  })

  it('cannot decline an acknowledged run or release capacity with a mismatched request digest', async () => {
    const state = await fixture()
    const host = await state.addHost()
    const launch = await host.launch()
    await host.send({ operation: 'pull', afterSequence: 0 })
    const decline = {
      operation: 'decline' as const,
      launchId: launch.launchId,
      requestDigest: 'f'.repeat(64),
      declineId: randomUUID(),
      reason: 'admission_paused' as const,
    }
    expect((await host.send(decline)).isErr()).toBe(true)
    await host.send({
      operation: 'acknowledge',
      launchId: launch.launchId,
      requestDigest: launch.requestDigest,
      runId: launch.launchId,
    })
    expect(
      (
        await host.send({ ...decline, requestDigest: launch.requestDigest })
      ).isErr(),
    ).toBe(true)
    const rows = await database.db
      .select()
      .from(schema.executionHostCapacity)
      .where(eq(schema.executionHostCapacity.operatorId, state.userId))
    expect(rows[0]?.launchRecordId).not.toBeNull()
  })
})
