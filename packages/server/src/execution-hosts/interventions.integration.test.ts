import { createHash, randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startTestDb, type TestDb } from '@garden/db/testing'
import * as schema from '@garden/db/schema'
import {
  hostContractVersion,
  hostInterventionSchema,
  hostOutcomeSchema,
  type HostEnrollment,
  type HostIntervention,
  type HostLaunch,
  type HostRequestUnsigned,
} from '@garden/core/execution-host/contracts'
import {
  HOST_REQUEST_WINDOW_MS,
  signHostRequest,
} from '@garden/core/execution-host/auth'
import { ExecutionHostReceiver, executionControlDigest } from './service'

/** The Harnessy controller computes the digest with Node crypto over the schema-ordered record. */
const harnessyDigest = (value: HostIntervention) =>
  createHash('sha256')
    .update(JSON.stringify(hostInterventionSchema.parse(value)))
    .digest('hex')

describe('external host interventions with actual PostgreSQL', () => {
  let database: TestDb
  beforeAll(async () => {
    database = await startTestDb()
  }, 120_000)
  afterAll(async () => {
    await database?.cleanup()
  })

  async function addUser(workspaceId: string, role: string) {
    const userId = randomUUID()
    await database.db.insert(schema.user).values({
      id: userId,
      email: `${userId}@example.test`,
      name: 'Intervention fixture',
    })
    await database.db
      .insert(schema.member)
      .values({ organizationId: workspaceId, userId, role })
    const sessionId = randomUUID()
    await database.db.insert(schema.session).values({
      id: sessionId,
      userId,
      token: randomUUID(),
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    })
    return { userId, sessionId }
  }

  /** An enrolled host with one acknowledged run, as the Harnessy controller holds it before an intervention. */
  async function fixture() {
    const workspaceId = randomUUID()
    await database.db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Intervention fixture',
      slug: `intervention-${workspaceId}`,
    })
    const pilot = await addUser(workspaceId, 'owner')
    let clock = 1_000_000
    const now = () => clock
    const receiverFor = (sessionId?: string) =>
      new ExecutionHostReceiver(database.db, pilot.userId, sessionId, now)
    const receiver = receiverFor(pilot.sessionId)
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
      operatorId: pilot.userId,
      publicKey: Buffer.from(
        await crypto.subtle.exportKey('raw', keys.publicKey),
      ).toString('base64url'),
      keyGeneration: 1,
      repositories: ['garden'],
      agent: 'claude-code',
      capabilityDigest: 'a'.repeat(64),
    }
    expect((await receiver.enroll(pilot.userId, enrollment)).isOk()).toBe(true)
    const sign = (body: HostRequestUnsigned['body'], signedAt = clock) =>
      signHostRequest(
        {
          contractVersion: hostContractVersion,
          hostId: enrollment.hostId,
          workspaceId,
          keyGeneration: 1,
          nonce: randomUUID(),
          signedAt,
          body,
        },
        keys.privateKey,
      )
    const send = async (body: HostRequestUnsigned['body']) =>
      receiver.receive(await sign(body), clock)
    const job: HostLaunch['job'] = {
      schema: 'harnessy.engineering.job.v1',
      id: randomUUID(),
      objective: 'intervention-fixture',
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
      memberId: pilot.userId,
      operatorId: pilot.userId,
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
    expect((await receiver.launch(pilot.userId, launch, clock)).isOk()).toBe(
      true,
    )
    expect((await send({ operation: 'pull', afterSequence: 0 })).isOk()).toBe(
      true,
    )
    expect(
      (
        await send({
          operation: 'acknowledge',
          launchId: launch.launchId,
          requestDigest: launch.requestDigest,
          runId: launch.launchId,
        })
      ).isOk(),
    ).toBe(true)
    clock += 1000
    const intervention: HostIntervention = {
      contractVersion: hostContractVersion,
      id: randomUUID(),
      workspaceId,
      hostId: enrollment.hostId,
      launchId: launch.launchId,
      runId: launch.launchId,
      grantId: launch.grant.id,
      sourceRevision: job.sourceRevision,
      taskRevision: job.taskRevision,
      kind: 'input',
      reason: 'allowance_unavailable',
      raisedAt: clock,
      expiresAt: launch.grant.expiresAt,
    }
    const rows = () =>
      database.db
        .select()
        .from(schema.executionHostIntervention)
        .where(eq(schema.executionHostIntervention.hostId, enrollment.hostId))
    const answer = (
      decision: 'resume' | 'stop',
      answerId = randomUUID(),
      actor = receiver,
      actorId = pilot.userId,
    ) =>
      actor.answer(
        actorId,
        workspaceId,
        launch.launchId,
        { interventionId: intervention.id, answerId, decision },
        clock,
      )
    const pullCommands = async () => {
      const outcome = (
        await send({ operation: 'pull', afterSequence: 0 })
      ).unwrap()
      if (outcome.kind !== 'commands') throw new Error('Expected commands')
      return outcome.commands
    }
    return {
      pilot,
      workspaceId,
      enrollment,
      keys,
      launch,
      intervention,
      receiver,
      receiverFor,
      sign,
      send,
      rows,
      answer,
      pullCommands,
      addUser: (role: string) => addUser(workspaceId, role),
      now,
      setClock: (value: number) => {
        clock = value
      },
    }
  }

  it('stores a valid signed intervention once and returns the same receipt on retry', async () => {
    const state = await fixture()
    const body = {
      operation: 'intervention' as const,
      intervention: state.intervention,
    }
    const receipt = {
      kind: 'intervention_recorded',
      launchId: state.launch.launchId,
      interventionId: state.intervention.id,
    }
    expect((await state.send(body)).unwrap()).toEqual(receipt)
    expect((await state.send(body)).unwrap()).toEqual(receipt)
    const stored = await state.rows()
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({
      interventionId: state.intervention.id,
      digest: harnessyDigest(state.intervention),
      intervention: state.intervention,
      answerId: null,
    })
    const reused = await state.send({
      operation: 'intervention',
      intervention: { ...state.intervention, kind: 'review' },
    })
    expect(reused.isErr() && reused.error.status).toBe(409)
    const changed = await state.send({
      operation: 'intervention',
      intervention: { ...state.intervention, raisedAt: state.now() - 1 },
    })
    expect(changed.isErr() && changed.error.status).toBe(409)
    expect(await state.rows()).toHaveLength(1)
  })

  it('refuses a forged, replayed, out-of-scope or expired intervention without storing it', async () => {
    const state = await fixture()
    const body = {
      operation: 'intervention' as const,
      intervention: state.intervention,
    }
    const signed = await state.sign(body)
    const forged = await state.receiver.receive(
      { ...signed, signature: 'A'.repeat(86) },
      state.now(),
    )
    expect(forged.isErr() && forged.error.status).toBe(401)
    const swapped = await state.receiver.receive(
      {
        ...signed,
        body: {
          operation: 'intervention',
          intervention: { ...state.intervention, id: randomUUID() },
        },
      },
      state.now(),
    )
    expect(swapped.isErr() && swapped.error.status).toBe(401)
    const foreignHost = await state.send({
      operation: 'intervention',
      intervention: { ...state.intervention, hostId: randomUUID() },
    })
    expect(foreignHost.isErr() && foreignHost.error.status).toBe(401)
    const scope: Array<Partial<HostIntervention>> = [
      { launchId: randomUUID() },
      { runId: randomUUID() },
      { grantId: randomUUID() },
      { sourceRevision: '9'.repeat(40) },
      { taskRevision: '9'.repeat(64) },
      { kind: 'review' },
      { raisedAt: state.now() + 1 },
      { expiresAt: state.launch.grant.expiresAt + 1 },
    ]
    for (const change of scope) {
      const result = await state.send({
        operation: 'intervention',
        intervention: { ...state.intervention, ...change },
      })
      expect(result.isErr(), JSON.stringify(change)).toBe(true)
    }
    const stale = await state.sign(
      body,
      state.now() - HOST_REQUEST_WINDOW_MS - 1,
    )
    const late = await state.receiver.receive(stale, state.now())
    expect(late.isErr() && late.error.status).toBe(401)
    const expired = await state.send({
      operation: 'intervention',
      intervention: { ...state.intervention, expiresAt: state.now() },
    })
    expect(expired.isErr() && expired.error.status).toBe(403)
    expect(await state.rows()).toHaveLength(0)
    expect((await state.receiver.receive(signed, state.now())).isOk()).toBe(
      true,
    )
    const replayed = await state.receiver.receive(signed, state.now())
    expect(replayed.isErr() && replayed.error.status).toBe(409)
    expect(await state.rows()).toHaveLength(1)
  })

  it('lets only the pilot operator with a current owner or admin role answer', async () => {
    const state = await fixture()
    await state.send({
      operation: 'intervention',
      intervention: state.intervention,
    })
    const owner = await state.addUser('owner')
    const otherOwner = await state.answer(
      'stop',
      randomUUID(),
      state.receiverFor(owner.sessionId),
      owner.userId,
    )
    expect(otherOwner.isErr() && otherOwner.error.status).toBe(403)
    const noSession = await state.answer(
      'stop',
      randomUUID(),
      state.receiverFor(),
    )
    expect(noSession.isErr() && noSession.error.status).toBe(401)
    await database.db
      .update(schema.member)
      .set({ role: 'member' })
      .where(eq(schema.member.userId, state.pilot.userId))
    const demoted = await state.answer('stop')
    expect(demoted.isErr() && demoted.error.status).toBe(403)
    expect((await state.rows())[0]?.answerId).toBeNull()
    await database.db
      .update(schema.member)
      .set({ role: 'admin' })
      .where(eq(schema.member.userId, state.pilot.userId))
    expect((await state.answer('stop')).isOk()).toBe(true)
  })

  it('delivers the answer in pull replies with the exact digest and bindings and no other effect', async () => {
    const state = await fixture()
    await state.send({
      operation: 'intervention',
      intervention: state.intervention,
    })
    const launchBefore = await database.db
      .select()
      .from(schema.executionHostLaunch)
      .where(eq(schema.executionHostLaunch.launchId, state.launch.launchId))
    const answerId = randomUUID()
    const answered = (await state.answer('resume', answerId)).unwrap()
    const expected = {
      contractVersion: hostContractVersion,
      answerId,
      interventionId: state.intervention.id,
      interventionDigest: harnessyDigest(state.intervention),
      workspaceId: state.workspaceId,
      hostId: state.enrollment.hostId,
      operatorId: state.enrollment.operatorId,
      launchId: state.launch.launchId,
      runId: state.launch.launchId,
      grantId: state.launch.grant.id,
      sourceRevision: state.launch.job.sourceRevision,
      taskRevision: state.launch.job.taskRevision,
      decision: 'resume',
      answeredAt: state.now(),
      expiresAt: state.intervention.expiresAt,
    }
    expect(answered).toEqual({
      kind: 'intervention_answered',
      answer: expected,
      replayed: false,
    })
    // A pull that the host signed before the answer time would be refused by the host clock check.
    const early = await state.receiver.receive(
      await state.sign(
        { operation: 'pull', afterSequence: 0 },
        state.now() - 1,
      ),
      state.now(),
    )
    expect(early.unwrap()).toEqual({ kind: 'commands', commands: [] })
    const first = await state.pullCommands()
    expect(first).toEqual([{ kind: 'answer', answer: expected }])
    expect(
      hostOutcomeSchema.parse({ kind: 'commands', commands: first }),
    ).toEqual({ kind: 'commands', commands: first })
    // A lost reply is repaired by the next pull with identical bytes; the host applies one identity once.
    expect(JSON.stringify(await state.pullCommands())).toBe(
      JSON.stringify(first),
    )
    expect((await state.answer('resume', answerId)).unwrap()).toEqual({
      kind: 'intervention_answered',
      answer: expected,
      replayed: true,
    })
    const changed = await state.answer('stop', answerId)
    expect(changed.isErr() && changed.error.status).toBe(409)
    const second = await state.answer('stop')
    expect(second.isErr() && second.error.status).toBe(409)
    expect(await state.rows()).toHaveLength(1)
    expect(
      await database.db
        .select()
        .from(schema.executionHostLaunch)
        .where(eq(schema.executionHostLaunch.launchId, state.launch.launchId)),
    ).toEqual(launchBefore)
    const widened = await state.receiver.answer(
      state.pilot.userId,
      state.workspaceId,
      state.launch.launchId,
      {
        interventionId: state.intervention.id,
        answerId: randomUUID(),
        decision: 'approve',
      },
      state.now(),
    )
    expect(widened.isErr() && widened.error.status).toBe(400)
    const extended = await state.receiver.answer(
      state.pilot.userId,
      state.workspaceId,
      state.launch.launchId,
      {
        interventionId: state.intervention.id,
        answerId: randomUUID(),
        decision: 'resume',
        expiresAt: state.intervention.expiresAt + 1,
      },
      state.now(),
    )
    expect(extended.isErr() && extended.error.status).toBe(400)
    const listed = (
      await state.receiver.interventions(
        state.pilot.userId,
        state.workspaceId,
        state.launch.launchId,
        state.now(),
      )
    ).unwrap()
    expect(listed.interventions).toEqual([
      {
        intervention: state.intervention,
        digest: harnessyDigest(state.intervention),
        status: 'answered',
        receivedAt: state.intervention.raisedAt,
        answer: expected,
      },
    ])
  })

  it('refuses an answer for an expired or closed intervention and stops delivery when the run ends', async () => {
    const state = await fixture()
    await state.send({
      operation: 'intervention',
      intervention: state.intervention,
    })
    const unknown = await state.receiver.answer(
      state.pilot.userId,
      state.workspaceId,
      state.launch.launchId,
      {
        interventionId: randomUUID(),
        answerId: randomUUID(),
        decision: 'stop',
      },
      state.now(),
    )
    expect(unknown.isErr() && unknown.error.status).toBe(404)
    const open = state.now()
    state.setClock(state.intervention.expiresAt)
    const expired = await state.answer('stop')
    expect(expired.isErr() && expired.error.status).toBe(409)
    expect(
      (
        await state.receiver.interventions(
          state.pilot.userId,
          state.workspaceId,
          state.launch.launchId,
          state.now(),
        )
      ).unwrap().interventions[0]?.status,
    ).toBe('expired')
    state.setClock(open)
    expect((await state.answer('stop')).isOk()).toBe(true)
    expect(await state.pullCommands()).toHaveLength(1)
    const terminal = await state.send({
      operation: 'event',
      event: {
        contractVersion: hostContractVersion,
        hostId: state.enrollment.hostId,
        workspaceId: state.workspaceId,
        launchId: state.launch.launchId,
        runId: state.launch.launchId,
        sequence: 1,
        at: state.now(),
        state: 'cancelled',
        reason: 'termination_confirmed',
        sourceRevision: state.launch.job.sourceRevision,
        evidenceDigest: 'e'.repeat(64),
      },
    })
    expect(terminal.isOk()).toBe(true)
    expect(await state.pullCommands()).toEqual([])
    const late = await state.send({
      operation: 'intervention',
      intervention: {
        ...state.intervention,
        id: randomUUID(),
        kind: 'review',
        reason: 'reconciliation_required',
      },
    })
    expect(late.isErr() && late.error.status).toBe(409)

    const closed = await fixture()
    await closed.send({
      operation: 'intervention',
      intervention: closed.intervention,
    })
    await closed.send({
      operation: 'event',
      event: {
        contractVersion: hostContractVersion,
        hostId: closed.enrollment.hostId,
        workspaceId: closed.workspaceId,
        launchId: closed.launch.launchId,
        runId: closed.launch.launchId,
        sequence: 1,
        at: closed.now(),
        state: 'failed',
        reason: 'allowance_unavailable',
        sourceRevision: closed.launch.job.sourceRevision,
        evidenceDigest: 'e'.repeat(64),
      },
    })
    const refused = await closed.answer('resume')
    expect(refused.isErr() && refused.error.status).toBe(409)
    expect(
      (
        await closed.receiver.interventions(
          closed.pilot.userId,
          closed.workspaceId,
          closed.launch.launchId,
          closed.now(),
        )
      ).unwrap().interventions[0]?.status,
    ).toBe('closed')
  })
})
