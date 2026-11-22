import {
  and,
  asc,
  eq,
  gt,
  lt,
  lte,
  isNotNull,
  isNull,
  ne,
  sql,
} from 'drizzle-orm'
import { Result, TaggedError } from 'better-result'
import { z } from 'zod'
import type { GardenDatabase } from '@garden/db'
import {
  executionHost,
  executionHostCapacity,
  executionHostEvent,
  executionHostIntervention,
  executionHostLaunch,
  executionHostNonce,
  member,
  session as authSession,
} from '@garden/db/schema'
import {
  hostCancelSchema,
  hostContractVersion,
  hostEnrollmentSchema,
  hostEventSchema,
  hostInterventionAnswerSchema,
  hostInterventionSchema,
  hostLaunchSchema,
  hostRequestSchema,
  hostDirectorySchema,
  hostSnapshotSchema,
  hostSummarySchema,
  launchReceiptSchema,
  type HostOutcome,
  type HostCancellationOutcome as CancellationOutcome,
  type LaunchReceipt,
  type HostEnrollment,
  type HostRequest,
  type HostIntervention,
  type HostInterventionAnswer,
} from '@garden/core/execution-host/contracts'
import {
  HOST_REQUEST_WINDOW_MS,
  verifyHostRequest,
} from '@garden/core/execution-host/auth'

type Transaction = Parameters<Parameters<GardenDatabase['transaction']>[0]>[0]

export class ExecutionHostError extends TaggedError('ExecutionHostError')<{
  code: 'host_refused' | 'host_conflict' | 'host_not_found' | 'db_error'
  message: string
  status: 400 | 401 | 403 | 404 | 409 | 503
  cause?: unknown
}>() {}

const refused = (message: string, status: ExecutionHostError['status'] = 403) =>
  Result.err(new ExecutionHostError({ code: 'host_refused', message, status }))
const conflict = (message: string) =>
  Result.err(
    new ExecutionHostError({ code: 'host_conflict', message, status: 409 }),
  )

/** Web Crypto hashes the same validated JSON that the host signs and reserves. */
export async function executionControlDigest(value: unknown) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  )
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

const terminalStates = ['succeeded', 'failed', 'cancelled']
/** The Harnessy controller raises each reason with one fixed kind. */
const interventionKinds: Readonly<
  Record<HostIntervention['reason'], HostIntervention['kind']>
> = {
  allowance_unavailable: 'input',
  reconciliation_required: 'review',
}

/** An operator answer names one retained intervention and one fixed decision. It carries no authority fields. */
export const interventionAnswerInputSchema = z.strictObject({
  interventionId: z.string().uuid(),
  answerId: z.string().uuid(),
  decision: hostInterventionAnswerSchema.shape.decision,
})

/** The operator view of the interventions of one run. Garden derives status; the host owns the run state. */
export const interventionListSchema = z.strictObject({
  kind: z.literal('interventions'),
  workspaceId: z.string().uuid(),
  launchId: z.string().uuid(),
  observedAt: z.number().int().nonnegative().safe(),
  interventions: z
    .array(
      z.strictObject({
        intervention: hostInterventionSchema,
        digest: z.string().regex(/^[a-f0-9]{64}$/),
        status: z.enum(['open', 'answered', 'expired', 'closed']),
        receivedAt: z.number().int().nonnegative().safe(),
        answer: hostInterventionAnswerSchema.nullable(),
      }),
    )
    .max(100),
})

export type InterventionList = z.infer<typeof interventionListSchema>
export type InterventionAnswerReceipt = {
  kind: 'intervention_answered'
  answer: HostInterventionAnswer
  replayed: boolean
}

/**
 * The deployment supplies the pilot identity. Request bodies cannot enable the pilot.
 * Host polling stores delivery facts only. Harnessy remains the execution owner.
 */
export class ExecutionHostReceiver {
  readonly #db: GardenDatabase
  readonly #pilotOperatorId: string
  readonly #memberSessionId: string | undefined
  readonly #clock: () => number

  constructor(
    db: GardenDatabase,
    pilotOperatorId: string,
    memberSessionId?: string,
    clock: () => number = Date.now,
  ) {
    this.#db = db
    this.#pilotOperatorId = pilotOperatorId
    this.#memberSessionId = memberSessionId
    this.#clock = clock
  }

  /** Membership rows stay locked through the delivery transaction so removal cannot race the effect. */
  async #authorized(tx: Transaction, actorId: string, workspaceId: string) {
    if (
      !hostEnrollmentSchema.shape.operatorId.safeParse(this.#pilotOperatorId)
        .success
    )
      return refused('The engineering pilot operator is not configured', 503)
    if (actorId !== this.#pilotOperatorId)
      return refused('This operator is outside the pilot')
    const rows = await tx
      .select({ role: member.role })
      .from(member)
      .where(
        and(eq(member.organizationId, workspaceId), eq(member.userId, actorId)),
      )
      .for('share')
    return rows.some((row) => row.role === 'owner' || row.role === 'admin')
      ? Result.ok({ kind: 'authorized' as const })
      : refused('Current workspace administration is required')
  }

  /** Session deletion waits for member effects. Signed host grants do not depend on a browser session. */
  async #memberAuthorized(
    tx: Transaction,
    actorId: string,
    workspaceId: string,
  ) {
    if (this.#memberSessionId === undefined)
      return refused('A current member session is required', 401)
    const sessions = await tx
      .select({ id: authSession.id })
      .from(authSession)
      .where(
        and(
          eq(authSession.id, this.#memberSessionId),
          eq(authSession.userId, actorId),
        ),
      )
      .for('share')
    if (sessions.length !== 1)
      return refused('A current member session is required', 401)
    const membership = await this.#authorized(tx, actorId, workspaceId)
    if (membership.isErr()) return membership
    // Time predicates must run after the locking statements finish, including unchanged-row waits.
    const current = await tx
      .select({ id: authSession.id })
      .from(authSession)
      .where(
        and(
          eq(authSession.id, this.#memberSessionId),
          eq(authSession.userId, actorId),
          gt(authSession.expiresAt, sql`clock_timestamp()`),
        ),
      )
    return current.length === 1
      ? membership
      : refused('A current member session is required', 401)
  }

  /** Refusals roll back all writes and preserve their typed cause across the driver's rollback signal. */
  async #transaction<T>(
    operation: (tx: Transaction) => Promise<Result<T, ExecutionHostError>>,
    finalAuthority?: (
      tx: Transaction,
      outcome: T,
    ) => Promise<Result<unknown, ExecutionHostError>>,
  ): Promise<Result<T, ExecutionHostError>> {
    let refusal: ExecutionHostError | undefined
    return Result.flatten(
      await Result.tryPromise({
        try: () =>
          this.#db.transaction(async (tx) => {
            const result = await operation(tx)
            if (result.isErr()) {
              refusal = result.error
              return tx.rollback()
            }
            if (finalAuthority) {
              const current = await finalAuthority(tx, result.value)
              if (current.isErr()) {
                refusal = current.error
                return tx.rollback()
              }
            }
            return result
          }),
        catch: (cause) =>
          refusal ??
          new ExecutionHostError({
            code: 'db_error',
            message: 'Execution host state is unavailable',
            status: 503,
            cause,
          }),
      }),
    )
  }

  /** Recheck member expiry after every later lock and roll back effects if authority expires before commit. */
  #memberTransaction<T>(
    actorId: string,
    workspaceId: string,
    operation: (tx: Transaction) => Promise<Result<T, ExecutionHostError>>,
    finalScope?: (outcome: T) => Result<unknown, ExecutionHostError>,
  ) {
    return this.#transaction(operation, async (tx, outcome) => {
      const authority = await this.#memberAuthorized(tx, actorId, workspaceId)
      return authority.isErr() || !finalScope ? authority : finalScope(outcome)
    })
  }

  /** Receipts report the retained delivery state, including retries after acknowledgment or cancellation. */
  #launchReceipt(row: typeof executionHostLaunch.$inferSelect) {
    const parsed = launchReceiptSchema.safeParse({
      kind: 'launch_receipt',
      launch: row.launch,
      deliveryStatus: row.status,
      runId: row.hostRunId,
      termination:
        row.cancelBeforeDispatch || row.declineId !== null
          ? 'not-started'
          : row.terminalAt !== null
            ? 'host-confirmed'
            : 'unconfirmed',
    })
    return parsed.success
      ? Result.ok(parsed.data)
      : conflict('Stored launch receipt is invalid')
  }

  /** Client host summaries omit private process state and report last contact without promising availability. */
  #hostSummary(row: typeof executionHost.$inferSelect) {
    const enrollment = hostEnrollmentSchema.safeParse(row.enrollment)
    if (!enrollment.success)
      return conflict('Stored host enrollment is invalid')
    const parsed = hostSummarySchema.safeParse({
      hostId: row.id,
      workspaceId: row.workspaceId,
      agent: enrollment.data.agent,
      repositories: enrollment.data.repositories,
      capabilityDigest: enrollment.data.capabilityDigest,
      keyGeneration: row.keyGeneration,
      status: row.status,
      lastSeenAt: row.lastSeenAt?.getTime() ?? null,
    })
    return parsed.success
      ? Result.ok(parsed.data)
      : conflict('Stored host summary is invalid')
  }

  /** Explicit workspace and UUID cursors keep host discovery bounded and separate across workspaces. */
  async directory(
    actorId: string,
    workspaceId: string,
    now: number,
    afterHostId?: string,
  ) {
    if (
      !Number.isSafeInteger(now) ||
      now < 0 ||
      (afterHostId !== undefined &&
        !hostEnrollmentSchema.shape.hostId.safeParse(afterHostId).success)
    )
      return refused('Invalid host cursor or clock', 400)
    return this.#memberTransaction(actorId, workspaceId, async (tx) => {
      const authorization = await this.#memberAuthorized(
        tx,
        actorId,
        workspaceId,
      )
      if (authorization.isErr()) return authorization
      const rows = await tx
        .select()
        .from(executionHost)
        .where(
          and(
            eq(executionHost.workspaceId, workspaceId),
            afterHostId === undefined
              ? undefined
              : gt(executionHost.id, afterHostId),
          ),
        )
        .orderBy(asc(executionHost.id))
        .limit(101)
      const hosts = []
      for (const row of rows.slice(0, 100)) {
        const summary = this.#hostSummary(row)
        if (summary.isErr()) return summary
        hosts.push(summary.value)
      }
      return Result.ok(
        hostDirectorySchema.parse({
          kind: 'hosts',
          workspaceId,
          observedAt: now,
          hosts,
          nextHostId: rows.length > 100 ? (hosts.at(-1)?.hostId ?? null) : null,
        }),
      )
    })
  }

  /** Enrollment registers a supplied public key. It does not create or transmit a private credential. */
  async enroll(
    actorId: string,
    input: unknown,
  ): Promise<
    Result<{ kind: 'enrolled'; enrollment: HostEnrollment }, ExecutionHostError>
  > {
    const parsed = hostEnrollmentSchema.safeParse(input)
    if (!parsed.success || parsed.data.operatorId !== actorId)
      return refused('Invalid host enrollment', 400)
    const enrollment = parsed.data
    return this.#memberTransaction(
      actorId,
      enrollment.workspaceId,
      async (tx) => {
        const authorization = await this.#memberAuthorized(
          tx,
          actorId,
          enrollment.workspaceId,
        )
        if (authorization.isErr()) return authorization
        const previous = await tx
          .select()
          .from(executionHost)
          .where(eq(executionHost.id, enrollment.hostId))
          .for('update')
        const existing = previous[0]
        if (existing) {
          if (
            existing.workspaceId !== enrollment.workspaceId ||
            existing.operatorId !== actorId ||
            existing.status !== 'enrolled'
          )
            return conflict('Host identity cannot be reused')
          const previousEnrollment = hostEnrollmentSchema.safeParse(
            existing.enrollment,
          )
          if (
            existing.keyGeneration === enrollment.keyGeneration &&
            previousEnrollment.success &&
            JSON.stringify(previousEnrollment.data) ===
              JSON.stringify(enrollment)
          )
            return Result.ok({ kind: 'enrolled' as const, enrollment })
          if (enrollment.keyGeneration !== existing.keyGeneration + 1)
            return conflict('Host changes require the next key generation')
          await tx
            .update(executionHost)
            .set({ enrollment, keyGeneration: enrollment.keyGeneration })
            .where(eq(executionHost.id, enrollment.hostId))
          return Result.ok({ kind: 'enrolled' as const, enrollment })
        }
        const inserted = await tx
          .insert(executionHost)
          .values({
            id: enrollment.hostId,
            workspaceId: enrollment.workspaceId,
            operatorId: actorId,
            enrollment,
            keyGeneration: enrollment.keyGeneration,
          })
          .onConflictDoNothing()
          .returning({ id: executionHost.id })
        return inserted.length === 1
          ? Result.ok({ kind: 'enrolled' as const, enrollment })
          : conflict('Host identity cannot be reused')
      },
    )
  }

  /** Launch retries compare immutable validated inputs before returning their existing delivery receipt. */
  async launch(
    actorId: string,
    input: unknown,
    now: number,
  ): Promise<Result<LaunchReceipt, ExecutionHostError>> {
    if (!Number.isSafeInteger(now) || now < 0)
      return refused('Invalid receiver clock', 400)
    const parsed = hostLaunchSchema.safeParse(input)
    if (!parsed.success) return refused('Invalid host launch', 400)
    const launch = parsed.data
    const { requestDigest: _digest, ...unsigned } = launch
    const jobDigest = await executionControlDigest(launch.job)
    if (
      launch.memberId !== actorId ||
      launch.operatorId !== this.#pilotOperatorId ||
      launch.grant.jobDigest !== jobDigest ||
      launch.requestDigest !== (await executionControlDigest(unsigned)) ||
      launch.grant.issuedAt > now ||
      launch.grant.expiresAt <= now
    )
      return refused('Launch scope, digest or authority is invalid', 400)
    return this.#memberTransaction(
      actorId,
      launch.workspaceId,
      async (tx) => {
        const authorization = await this.#memberAuthorized(
          tx,
          actorId,
          launch.workspaceId,
        )
        if (authorization.isErr()) return authorization
        const hosts = await tx
          .select()
          .from(executionHost)
          .where(
            and(
              eq(executionHost.id, launch.hostId),
              eq(executionHost.workspaceId, launch.workspaceId),
            ),
          )
          .for('update')
        const host = hosts[0]
        const enrollment = hostEnrollmentSchema.safeParse(host?.enrollment)
        if (
          !host ||
          host.status !== 'enrolled' ||
          !enrollment.success ||
          host.operatorId !== launch.operatorId ||
          enrollment.data.capabilityDigest !== launch.capabilityDigest ||
          !enrollment.data.repositories.includes(launch.job.repository)
        )
          return refused('Host enrollment does not permit this launch')
        const existing = await tx
          .select()
          .from(executionHostLaunch)
          .where(
            and(
              eq(executionHostLaunch.workspaceId, launch.workspaceId),
              eq(executionHostLaunch.launchId, launch.launchId),
            ),
          )
          .for('update')
        if (existing[0])
          return existing[0].requestDigest === launch.requestDigest
            ? this.#launchReceipt(existing[0])
            : conflict('Launch identity has different immutable inputs')
        const inserted = await tx
          .insert(executionHostLaunch)
          .values({
            launchId: launch.launchId,
            workspaceId: launch.workspaceId,
            hostId: launch.hostId,
            memberId: actorId,
            requestDigest: launch.requestDigest,
            launch,
            expiresAt: new Date(launch.grant.expiresAt),
          })
          .onConflictDoNothing({
            target: [
              executionHostLaunch.workspaceId,
              executionHostLaunch.launchId,
            ],
          })
          .returning()
        if (inserted[0]) return this.#launchReceipt(inserted[0])
        const concurrent = await tx
          .select()
          .from(executionHostLaunch)
          .where(
            and(
              eq(executionHostLaunch.workspaceId, launch.workspaceId),
              eq(executionHostLaunch.launchId, launch.launchId),
            ),
          )
        return concurrent[0]?.requestDigest === launch.requestDigest
          ? this.#launchReceipt(concurrent[0])
          : conflict('Launch identity has different immutable inputs')
      },
      () => {
        const current = this.#clock()
        return Number.isSafeInteger(current) &&
          current >= launch.grant.issuedAt &&
          current < launch.grant.expiresAt
          ? Result.ok({ kind: 'authority_current' as const })
          : refused('Launch authority expired before commit')
      },
    )
  }

  /** Revocation blocks every subsequent signed operation, including a valid request prepared before revocation. */
  async revoke(
    actorId: string,
    workspaceId: string,
    hostId: string,
    now: number,
  ): Promise<Result<{ kind: 'revoked' }, ExecutionHostError>> {
    if (!Number.isSafeInteger(now) || now < 0)
      return refused('Invalid receiver clock', 400)
    return this.#memberTransaction(actorId, workspaceId, async (tx) => {
      const authorization = await this.#memberAuthorized(
        tx,
        actorId,
        workspaceId,
      )
      if (authorization.isErr()) return authorization
      await tx
        .update(executionHost)
        .set({ status: 'revoked', revokedAt: new Date(now) })
        .where(
          and(
            eq(executionHost.id, hostId),
            eq(executionHost.workspaceId, workspaceId),
            eq(executionHost.operatorId, actorId),
          ),
        )
      await tx
        .update(executionHostLaunch)
        .set({ status: 'revoked' })
        .where(
          and(
            eq(executionHostLaunch.hostId, hostId),
            eq(executionHostLaunch.workspaceId, workspaceId),
          ),
        )
      return Result.ok({ kind: 'revoked' as const })
    })
  }

  /** Signature verification runs again against the locked current key before nonce consumption and any effect. */
  async receive(
    input: unknown,
    now: number,
  ): Promise<Result<HostOutcome, ExecutionHostError>> {
    const parsed = hostRequestSchema.safeParse(input)
    if (!parsed.success || !Number.isSafeInteger(now) || now < 0)
      return refused('Malformed host request', 400)
    const request = parsed.data
    return this.#transaction(
      async (tx) => {
        const hosts = await tx
          .select()
          .from(executionHost)
          .where(
            and(
              eq(executionHost.id, request.hostId),
              eq(executionHost.workspaceId, request.workspaceId),
            ),
          )
          .for('update')
        const host = hosts[0]
        if (!host || host.status !== 'enrolled')
          return refused('Host enrollment is unavailable', 401)
        const observedAt = this.#clock()
        if (!Number.isSafeInteger(observedAt) || observedAt < 0)
          return refused('Invalid receiver clock', 503)
        if (host.lastSeenAt !== null && observedAt < host.lastSeenAt.getTime())
          return refused('Receiver clock regressed', 400)
        const verified = await verifyHostRequest(
          request,
          host.enrollment,
          observedAt,
        )
        if (verified.status !== 'verified')
          return refused('Host signature or scope is invalid', 401)
        const authorization = await this.#authorized(
          tx,
          host.operatorId,
          host.workspaceId,
        )
        if (authorization.isErr()) return authorization
        const consumed = await tx
          .insert(executionHostNonce)
          .values({
            hostId: request.hostId,
            keyGeneration: request.keyGeneration,
            nonce: request.nonce,
            signedAt: new Date(request.signedAt),
          })
          .onConflictDoNothing()
          .returning({ nonce: executionHostNonce.nonce })
        if (consumed.length !== 1)
          return conflict('Signed host request was already consumed')
        await tx
          .delete(executionHostNonce)
          .where(
            and(
              eq(executionHostNonce.hostId, request.hostId),
              lt(
                executionHostNonce.signedAt,
                new Date(observedAt - HOST_REQUEST_WINDOW_MS),
              ),
            ),
          )
        await tx
          .update(executionHost)
          .set({ lastSeenAt: new Date(observedAt) })
          .where(eq(executionHost.id, request.hostId))
        return this.#operation(tx, request, verified.enrollment, observedAt)
      },
      async (tx, outcome) => {
        const current = this.#clock()
        const hosts = await tx
          .select()
          .from(executionHost)
          .where(eq(executionHost.id, request.hostId))
        const host = hosts[0]
        if (!host || host.status !== 'enrolled')
          return refused('Host enrollment is unavailable', 401)
        if (
          !Number.isSafeInteger(current) ||
          current < 0 ||
          (host.lastSeenAt !== null && current < host.lastSeenAt.getTime())
        )
          return refused('Receiver clock regressed before commit', 400)
        const fresh = await verifyHostRequest(request, host.enrollment, current)
        if (fresh.status !== 'verified')
          return refused('Host request expired before commit', 401)
        if (
          (outcome.kind === 'authority_current' &&
            outcome.expiresAt <= current) ||
          (outcome.kind === 'commands' &&
            outcome.commands.some(
              (command) =>
                (command.kind === 'launch'
                  ? command.launch.grant.expiresAt
                  : command.kind === 'cancel'
                    ? command.command.expiresAt
                    : command.answer.expiresAt) <= current,
            ))
        )
          return refused('Host command authority expired before commit')
        await tx
          .update(executionHost)
          .set({ lastSeenAt: new Date(current) })
          .where(eq(executionHost.id, request.hostId))
        return Result.ok({ kind: 'authority_current' as const })
      },
    )
  }

  /** A cancellation receipt does not claim that an offline or running host stopped. */
  async cancel(
    actorId: string,
    workspaceId: string,
    launchId: string,
    commandId: string,
    now: number,
  ): Promise<Result<CancellationOutcome, ExecutionHostError>> {
    if (
      !Number.isSafeInteger(now) ||
      now < 0 ||
      !hostEnrollmentSchema.shape.hostId.safeParse(commandId).success
    )
      return refused('Invalid cancellation identity or clock', 400)
    return this.#memberTransaction<CancellationOutcome>(
      actorId,
      workspaceId,
      async (tx) => {
        const authorization = await this.#memberAuthorized(
          tx,
          actorId,
          workspaceId,
        )
        if (authorization.isErr()) return authorization
        const rows = await tx
          .select()
          .from(executionHostLaunch)
          .where(
            and(
              eq(executionHostLaunch.workspaceId, workspaceId),
              eq(executionHostLaunch.launchId, launchId),
            ),
          )
          .for('update')
        const row = rows[0]
        if (!row)
          return Result.err(
            new ExecutionHostError({
              code: 'host_not_found',
              message: 'Launch not found',
              status: 404,
            }),
          )
        if (row.cancelBeforeDispatch)
          return row.cancelCommandId === null
            ? conflict('Stored cancellation receipt is invalid')
            : Result.ok({
                kind: 'cancelled_before_dispatch' as const,
                commandId: row.cancelCommandId,
                launchId,
                termination: 'not-started' as const,
              })
        if (row.terminalAt !== null)
          return Result.ok({ kind: 'already_terminal' as const, launchId })
        const capacity = await tx
          .select()
          .from(executionHostCapacity)
          .where(eq(executionHostCapacity.operatorId, this.#pilotOperatorId))
        const retainedCommand = row.cancelCommandId ?? commandId
        if (row.hostRunId === null && capacity[0]?.launchRecordId !== row.id) {
          await tx
            .update(executionHostLaunch)
            .set({
              status: 'revoked',
              cancelCommandId: retainedCommand,
              cancelRequestedAt: new Date(now),
              cancelBeforeDispatch: true,
              terminalAt: new Date(now),
            })
            .where(eq(executionHostLaunch.id, row.id))
          return Result.ok({
            kind: 'cancelled_before_dispatch' as const,
            commandId: retainedCommand,
            launchId,
            termination: 'not-started' as const,
          })
        }
        if (row.cancelCommandId === null)
          await tx
            .update(executionHostLaunch)
            .set({
              cancelCommandId: commandId,
              cancelRequestedAt: new Date(now),
            })
            .where(eq(executionHostLaunch.id, row.id))
        return Result.ok({
          kind: 'cancellation_received' as const,
          commandId: retainedCommand,
          launchId,
          termination: 'unconfirmed' as const,
        })
      },
    )
  }

  /** Reads one locked launch and a bounded event page after rechecking current workspace authority. */
  async snapshot(
    actorId: string,
    workspaceId: string,
    launchId: string,
    afterSequence = 0,
  ) {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0)
      return refused('Invalid event cursor', 400)
    return this.#memberTransaction(actorId, workspaceId, async (tx) => {
      const authorization = await this.#memberAuthorized(
        tx,
        actorId,
        workspaceId,
      )
      if (authorization.isErr()) return authorization
      const rows = await tx
        .select()
        .from(executionHostLaunch)
        .where(
          and(
            eq(executionHostLaunch.workspaceId, workspaceId),
            eq(executionHostLaunch.launchId, launchId),
          ),
        )
        .for('share')
      const row = rows[0]
      if (!row)
        return Result.err(
          new ExecutionHostError({
            code: 'host_not_found',
            message: 'Launch not found',
            status: 404,
          }),
        )
      if (afterSequence > row.lastEventSequence)
        return conflict('Event cursor is beyond the authorized snapshot')
      const events = await tx
        .select()
        .from(executionHostEvent)
        .where(
          and(
            eq(executionHostEvent.launchRecordId, row.id),
            gt(executionHostEvent.sequence, afterSequence),
          ),
        )
        .orderBy(asc(executionHostEvent.sequence))
        .limit(200)
      const latest = await tx
        .select()
        .from(executionHostEvent)
        .where(
          and(
            eq(executionHostEvent.launchRecordId, row.id),
            eq(executionHostEvent.sequence, row.lastEventSequence),
          ),
        )
      const hosts = await tx
        .select()
        .from(executionHost)
        .where(
          and(
            eq(executionHost.id, row.hostId),
            eq(executionHost.workspaceId, workspaceId),
          ),
        )
      if (!hosts[0]) return conflict('Stored launch host is unavailable')
      const summary = this.#hostSummary(hosts[0])
      if (summary.isErr()) return summary
      const snapshot = hostSnapshotSchema.safeParse({
        kind: 'snapshot',
        workspaceId,
        job: row.launch.job,
        host: summary.value,
        launchId,
        hostId: row.hostId,
        runId: row.hostRunId,
        deliveryStatus: row.status,
        lastSequence: row.lastEventSequence,
        cancellation: row.cancelCommandId === null ? 'none' : 'requested',
        termination:
          row.cancelBeforeDispatch || row.declineId !== null
            ? 'not-started'
            : row.terminalAt !== null
              ? 'host-confirmed'
              : 'unconfirmed',
        nextCursor: events.at(-1)?.sequence ?? afterSequence,
        hasMore:
          (events.at(-1)?.sequence ?? afterSequence) < row.lastEventSequence,
        latestEvent: latest[0] ? hostEventSchema.parse(latest[0].event) : null,
        events: events.map((event) => event.event),
      })
      return snapshot.success
        ? Result.ok(snapshot.data)
        : conflict('Stored run snapshot is invalid')
    })
  }

  /** A run is closed when Garden retained a terminal event, a revocation or a confirmed end. */
  async #runClosed(
    tx: Transaction,
    row: typeof executionHostLaunch.$inferSelect,
  ) {
    if (row.status === 'revoked' || row.terminalAt !== null) return true
    if (row.lastEventSequence === 0) return false
    const latest = await tx
      .select()
      .from(executionHostEvent)
      .where(
        and(
          eq(executionHostEvent.launchRecordId, row.id),
          eq(executionHostEvent.sequence, row.lastEventSequence),
        ),
      )
    const event = hostEventSchema.safeParse(latest[0]?.event)
    return !event.success || terminalStates.includes(event.data.state)
  }

  /**
   * The digest is the SHA-256 of the schema-ordered JSON that the host signed. The host
   * refuses any answer whose digest or bindings differ from its own retained record.
   */
  async #recordIntervention(
    tx: Transaction,
    row: typeof executionHostLaunch.$inferSelect,
    launch: ReturnType<typeof hostLaunchSchema.parse>,
    input: HostIntervention,
    now: number,
  ): Promise<Result<HostOutcome, ExecutionHostError>> {
    const intervention = hostInterventionSchema.parse(input)
    const receipt = {
      kind: 'intervention_recorded' as const,
      launchId: intervention.launchId,
      interventionId: intervention.id,
    }
    if (
      row.hostRunId === null ||
      intervention.runId !== row.hostRunId ||
      intervention.grantId !== launch.grant.id ||
      intervention.sourceRevision !== launch.job.sourceRevision ||
      intervention.taskRevision !== launch.job.taskRevision ||
      interventionKinds[intervention.reason] !== intervention.kind ||
      intervention.raisedAt < launch.grant.issuedAt ||
      intervention.raisedAt > now ||
      intervention.expiresAt > launch.grant.expiresAt
    )
      return conflict('Intervention does not match the current run scope')
    const digest = await executionControlDigest(intervention)
    const retained = () =>
      tx
        .select({ digest: executionHostIntervention.digest })
        .from(executionHostIntervention)
        .where(
          and(
            eq(executionHostIntervention.hostId, intervention.hostId),
            eq(executionHostIntervention.interventionId, intervention.id),
          ),
        )
    const existing = await retained()
    if (existing[0])
      return existing[0].digest === digest
        ? Result.ok(receipt)
        : conflict('Intervention identity was reused')
    if (intervention.expiresAt <= now) return refused('Intervention expired')
    if (await this.#runClosed(tx, row))
      return conflict('A closed run cannot raise an intervention')
    const inserted = await tx
      .insert(executionHostIntervention)
      .values({
        interventionId: intervention.id,
        launchRecordId: row.id,
        hostId: intervention.hostId,
        workspaceId: intervention.workspaceId,
        digest,
        intervention,
        expiresAt: new Date(intervention.expiresAt),
        receivedAt: new Date(now),
      })
      .onConflictDoNothing({
        target: [
          executionHostIntervention.hostId,
          executionHostIntervention.interventionId,
        ],
      })
      .returning({ id: executionHostIntervention.id })
    if (inserted.length === 1) return Result.ok(receipt)
    const concurrent = await retained()
    return concurrent[0]?.digest === digest
      ? Result.ok(receipt)
      : conflict('Intervention identity was reused')
  }

  /** Lists the retained interventions of one run for the current pilot operator. */
  async interventions(
    actorId: string,
    workspaceId: string,
    launchId: string,
    now: number,
  ): Promise<Result<InterventionList, ExecutionHostError>> {
    if (!Number.isSafeInteger(now) || now < 0)
      return refused('Invalid receiver clock', 400)
    return this.#memberTransaction(actorId, workspaceId, async (tx) => {
      const authorization = await this.#memberAuthorized(
        tx,
        actorId,
        workspaceId,
      )
      if (authorization.isErr()) return authorization
      const rows = await tx
        .select()
        .from(executionHostLaunch)
        .where(
          and(
            eq(executionHostLaunch.workspaceId, workspaceId),
            eq(executionHostLaunch.launchId, launchId),
          ),
        )
        .for('share')
      const row = rows[0]
      if (!row)
        return Result.err(
          new ExecutionHostError({
            code: 'host_not_found',
            message: 'Launch not found',
            status: 404,
          }),
        )
      const closed = await this.#runClosed(tx, row)
      const retained = await tx
        .select()
        .from(executionHostIntervention)
        .where(eq(executionHostIntervention.launchRecordId, row.id))
        .orderBy(asc(executionHostIntervention.receivedAt))
        .limit(100)
      const list = interventionListSchema.safeParse({
        kind: 'interventions',
        workspaceId,
        launchId,
        observedAt: now,
        interventions: retained.map((entry) => ({
          intervention: entry.intervention,
          digest: entry.digest,
          status:
            entry.answer !== null
              ? 'answered'
              : closed
                ? 'closed'
                : entry.expiresAt.getTime() <= now
                  ? 'expired'
                  : 'open',
          receivedAt: entry.receivedAt.getTime(),
          answer: entry.answer,
        })),
      })
      return list.success
        ? Result.ok(list.data)
        : conflict('Stored interventions are invalid')
    })
  }

  /**
   * Records one resume or stop answer. Every binding is copied from the retained intervention,
   * so an answer cannot name another run, approve a job, or extend a grant.
   */
  async answer(
    actorId: string,
    workspaceId: string,
    launchId: string,
    input: unknown,
    now: number,
  ): Promise<Result<InterventionAnswerReceipt, ExecutionHostError>> {
    const parsed = interventionAnswerInputSchema.safeParse(input)
    if (!parsed.success || !Number.isSafeInteger(now) || now < 0)
      return refused('Invalid intervention answer', 400)
    const { interventionId, answerId, decision } = parsed.data
    let expiresAt = 0
    return this.#memberTransaction<InterventionAnswerReceipt>(
      actorId,
      workspaceId,
      async (tx) => {
        const authorization = await this.#memberAuthorized(
          tx,
          actorId,
          workspaceId,
        )
        if (authorization.isErr()) return authorization
        const rows = await tx
          .select()
          .from(executionHostLaunch)
          .where(
            and(
              eq(executionHostLaunch.workspaceId, workspaceId),
              eq(executionHostLaunch.launchId, launchId),
            ),
          )
          .for('update')
        const row = rows[0]
        const retained = row
          ? await tx
              .select()
              .from(executionHostIntervention)
              .where(
                and(
                  eq(executionHostIntervention.launchRecordId, row.id),
                  eq(executionHostIntervention.interventionId, interventionId),
                ),
              )
              .for('update')
          : []
        const entry = retained[0]
        if (!row || !entry)
          return Result.err(
            new ExecutionHostError({
              code: 'host_not_found',
              message: 'Intervention not found',
              status: 404,
            }),
          )
        if (entry.answer !== null) {
          const previous = hostInterventionAnswerSchema.safeParse(entry.answer)
          return previous.success &&
            previous.data.answerId === answerId &&
            previous.data.decision === decision
            ? Result.ok({
                kind: 'intervention_answered' as const,
                answer: previous.data,
                replayed: true,
              })
            : conflict('Intervention is already answered')
        }
        const intervention = hostInterventionSchema.safeParse(
          entry.intervention,
        )
        if (
          !intervention.success ||
          (await executionControlDigest(intervention.data)) !== entry.digest
        )
          return conflict('Stored intervention is invalid')
        const record = intervention.data
        expiresAt = record.expiresAt
        if (record.expiresAt <= now) return conflict('Intervention expired')
        if (await this.#runClosed(tx, row)) return conflict('The run is closed')
        if (now < record.raisedAt)
          return conflict('Receiver clock precedes the intervention')
        const hosts = await tx
          .select({ operatorId: executionHost.operatorId })
          .from(executionHost)
          .where(
            and(
              eq(executionHost.id, record.hostId),
              eq(executionHost.workspaceId, workspaceId),
            ),
          )
        if (hosts[0]?.operatorId !== actorId)
          return refused('Only the host operator can answer')
        const reused = await tx
          .select({ id: executionHostIntervention.id })
          .from(executionHostIntervention)
          .where(eq(executionHostIntervention.answerId, answerId))
        if (reused.length > 0) return conflict('Answer identity was reused')
        const answer = hostInterventionAnswerSchema.parse({
          contractVersion: hostContractVersion,
          answerId,
          interventionId: record.id,
          interventionDigest: entry.digest,
          workspaceId: record.workspaceId,
          hostId: record.hostId,
          operatorId: actorId,
          launchId: record.launchId,
          runId: record.runId,
          grantId: record.grantId,
          sourceRevision: record.sourceRevision,
          taskRevision: record.taskRevision,
          decision,
          answeredAt: now,
          expiresAt: record.expiresAt,
        })
        const updated = await tx
          .update(executionHostIntervention)
          .set({
            answerId,
            answer,
            answeredBy: actorId,
            answeredAt: new Date(now),
          })
          .where(
            and(
              eq(executionHostIntervention.id, entry.id),
              isNull(executionHostIntervention.answerId),
            ),
          )
          .returning({ id: executionHostIntervention.id })
        return updated.length === 1
          ? Result.ok({
              kind: 'intervention_answered' as const,
              answer,
              replayed: false,
            })
          : conflict('Intervention is already answered')
      },
      (outcome) => {
        const current = this.#clock()
        return outcome.replayed ||
          (Number.isSafeInteger(current) && current < expiresAt)
          ? Result.ok({ kind: 'authority_current' as const })
          : refused('Intervention expired before commit')
      },
    )
  }

  /** Commands remain pending until acknowledgment. Polling never creates a replacement launch identity. */
  async #operation(
    tx: Transaction,
    request: HostRequest,
    enrollment: HostEnrollment,
    now: number,
  ): Promise<Result<HostOutcome, ExecutionHostError>> {
    if (request.body.operation === 'pull') {
      await tx
        .insert(executionHostCapacity)
        .values({ operatorId: this.#pilotOperatorId })
        .onConflictDoNothing()
      const capacity = await tx
        .select()
        .from(executionHostCapacity)
        .where(eq(executionHostCapacity.operatorId, this.#pilotOperatorId))
        .for('update')
      const reserved = capacity[0]?.launchRecordId ?? null
      const cancellationRows = await tx
        .select()
        .from(executionHostLaunch)
        .where(
          and(
            eq(executionHostLaunch.hostId, request.hostId),
            eq(executionHostLaunch.workspaceId, request.workspaceId),
            isNotNull(executionHostLaunch.cancelCommandId),
            isNull(executionHostLaunch.terminalAt),
            ne(executionHostLaunch.status, 'revoked'),
          ),
        )
        .orderBy(asc(executionHostLaunch.createdAt))
        .limit(20)
        .for('update')
      const commands: Extract<HostOutcome, { kind: 'commands' }>['commands'] =
        []
      for (const row of cancellationRows) {
        const authorization = await this.#authorized(
          tx,
          row.memberId,
          request.workspaceId,
        )
        if (authorization.isErr()) return authorization
        const previous = await tx
          .select()
          .from(executionHostEvent)
          .where(
            and(
              eq(executionHostEvent.launchRecordId, row.id),
              eq(executionHostEvent.sequence, row.lastEventSequence),
            ),
          )
        const latest = hostEventSchema.safeParse(previous[0]?.event)
        if (
          latest.success &&
          ['succeeded', 'failed', 'cancelled'].includes(latest.data.state)
        )
          continue
        const launch = hostLaunchSchema.parse(row.launch)
        commands.push({
          kind: 'cancel',
          command: hostCancelSchema.parse({
            contractVersion: hostContractVersion,
            commandId: row.cancelCommandId,
            workspaceId: row.workspaceId,
            hostId: row.hostId,
            launchId: row.launchId,
            runId: row.hostRunId ?? row.launchId,
            grantId: launch.grant.id,
            sourceRevision: launch.job.sourceRevision,
            expiresAt: now + HOST_REQUEST_WINDOW_MS,
          }),
        })
      }
      // Answers repeat with identical bytes until they expire or the run ends, because
      // a pull reply can be lost and the host applies one answer identity once.
      // A host clock behind the answer time would refuse it, so such a pull waits.
      const answerRows =
        commands.length >= 20
          ? []
          : await tx
              .select({
                answer: executionHostIntervention.answer,
                answeredBy: executionHostIntervention.answeredBy,
              })
              .from(executionHostIntervention)
              .innerJoin(
                executionHostLaunch,
                eq(
                  executionHostLaunch.id,
                  executionHostIntervention.launchRecordId,
                ),
              )
              .where(
                and(
                  eq(executionHostIntervention.hostId, request.hostId),
                  eq(
                    executionHostIntervention.workspaceId,
                    request.workspaceId,
                  ),
                  isNotNull(executionHostIntervention.answerId),
                  gt(executionHostIntervention.expiresAt, new Date(now)),
                  lte(
                    executionHostIntervention.answeredAt,
                    new Date(request.signedAt),
                  ),
                  isNull(executionHostLaunch.terminalAt),
                  ne(executionHostLaunch.status, 'revoked'),
                ),
              )
              .orderBy(asc(executionHostIntervention.answeredAt))
              .limit(20 - commands.length)
      for (const row of answerRows) {
        const answer = hostInterventionAnswerSchema.safeParse(row.answer)
        if (
          !answer.success ||
          row.answeredBy !== answer.data.operatorId ||
          answer.data.operatorId !== enrollment.operatorId
        )
          return conflict('Stored intervention answer is invalid')
        const authorization = await this.#authorized(
          tx,
          answer.data.operatorId,
          request.workspaceId,
        )
        if (authorization.isErr()) return authorization
        commands.push({ kind: 'answer', answer: answer.data })
      }
      const launches = await tx
        .select()
        .from(executionHostLaunch)
        .where(
          and(
            eq(executionHostLaunch.hostId, request.hostId),
            eq(executionHostLaunch.workspaceId, request.workspaceId),
            eq(executionHostLaunch.status, 'pending'),
            gt(executionHostLaunch.expiresAt, new Date(now)),
          ),
        )
        .orderBy(asc(executionHostLaunch.createdAt))
        .limit(20)
        .for('update')
      for (const row of launches) {
        if (row.cancelCommandId !== null) continue
        if (reserved !== null && reserved !== row.id) continue
        const launch = hostLaunchSchema.safeParse(row.launch)
        if (!launch.success)
          return conflict('Stored launch contract is invalid')
        if (
          launch.data.capabilityDigest !== enrollment.capabilityDigest ||
          !enrollment.repositories.includes(launch.data.job.repository)
        )
          continue
        const authorization = await this.#authorized(
          tx,
          row.memberId,
          request.workspaceId,
        )
        if (authorization.isErr()) return authorization
        if (reserved === null)
          await tx
            .update(executionHostCapacity)
            .set({ launchRecordId: row.id, reservedAt: new Date(now) })
            .where(eq(executionHostCapacity.operatorId, this.#pilotOperatorId))
        commands.push({ kind: 'launch', launch: launch.data })
        break
      }
      return Result.ok({ kind: 'commands', commands })
    }
    const body = request.body
    const launchId =
      body.operation === 'event'
        ? body.event.launchId
        : body.operation === 'intervention'
          ? body.intervention.launchId
          : body.launchId
    const rows = await tx
      .select()
      .from(executionHostLaunch)
      .where(
        and(
          eq(executionHostLaunch.hostId, request.hostId),
          eq(executionHostLaunch.workspaceId, request.workspaceId),
          eq(executionHostLaunch.launchId, launchId),
        ),
      )
      .for('update')
    const row = rows[0]
    if (!row)
      return Result.err(
        new ExecutionHostError({
          code: 'host_not_found',
          message: 'Launch not found',
          status: 404,
        }),
      )
    const parsed = hostLaunchSchema.safeParse(row.launch)
    if (!parsed.success) return conflict('Stored launch contract is invalid')
    const launch = parsed.data
    const authorization = await this.#authorized(
      tx,
      row.memberId,
      request.workspaceId,
    )
    if (authorization.isErr()) return authorization
    if (body.operation === 'intervention')
      return this.#recordIntervention(tx, row, launch, body.intervention, now)
    if (body.operation === 'decline') {
      if (body.requestDigest !== row.requestDigest)
        return conflict('Decline differs from immutable launch inputs')
      if (row.declineId !== null)
        return row.declineId === body.declineId &&
          row.declineReason === body.reason
          ? Result.ok({
              kind: 'declined',
              launchId,
              requestDigest: row.requestDigest,
              declineId: body.declineId,
              reason: body.reason,
              termination: 'not-started',
            })
          : conflict('Decline identity has different immutable inputs')
      if (
        row.status !== 'pending' ||
        row.hostRunId !== null ||
        row.lastEventSequence !== 0 ||
        row.terminalAt !== null
      )
        return conflict(
          'An acknowledged or terminal run cannot be declined before start',
        )
      const capacity = await tx
        .select()
        .from(executionHostCapacity)
        .where(eq(executionHostCapacity.operatorId, this.#pilotOperatorId))
        .for('update')
      if (capacity[0]?.launchRecordId !== row.id)
        return conflict('Launch has no operator-wide execution reservation')
      await tx
        .update(executionHostLaunch)
        .set({
          declineId: body.declineId,
          declineReason: body.reason,
          status: 'revoked',
          terminalAt: new Date(this.#clock()),
        })
        .where(eq(executionHostLaunch.id, row.id))
      await tx
        .update(executionHostCapacity)
        .set({ launchRecordId: null, reservedAt: null })
        .where(
          and(
            eq(executionHostCapacity.operatorId, this.#pilotOperatorId),
            eq(executionHostCapacity.launchRecordId, row.id),
          ),
        )
      return Result.ok({
        kind: 'declined',
        launchId,
        requestDigest: row.requestDigest,
        declineId: body.declineId,
        reason: body.reason,
        termination: 'not-started',
      })
    }
    if (body.operation === 'authority') {
      if (
        row.status === 'revoked' ||
        launch.grant.id !== body.grantId ||
        launch.grant.expiresAt <= now
      )
        return Result.ok({
          kind: 'authority_refused',
          reason: 'expired_or_revoked',
        })
      if (row.cancelCommandId !== null)
        return Result.ok({
          kind: 'authority_refused',
          reason: 'cancellation_requested',
        })
      if (
        launch.capabilityDigest !== enrollment.capabilityDigest ||
        !enrollment.repositories.includes(launch.job.repository)
      )
        return Result.ok({
          kind: 'authority_refused',
          reason: 'capability_changed',
        })
      const previous = await tx
        .select()
        .from(executionHostEvent)
        .where(
          and(
            eq(executionHostEvent.launchRecordId, row.id),
            eq(executionHostEvent.sequence, row.lastEventSequence),
          ),
        )
      const event = hostEventSchema.safeParse(previous[0]?.event)
      if (
        event.success &&
        ['succeeded', 'failed', 'cancelled'].includes(event.data.state)
      )
        return Result.ok({ kind: 'authority_refused', reason: 'terminal' })
      const capacity = await tx
        .select()
        .from(executionHostCapacity)
        .where(eq(executionHostCapacity.operatorId, this.#pilotOperatorId))
        .for('share')
      return Result.ok(
        capacity[0]?.launchRecordId === row.id
          ? {
              kind: 'authority_current',
              launchId,
              grantId: body.grantId,
              expiresAt: launch.grant.expiresAt,
            }
          : { kind: 'authority_refused', reason: 'capacity_missing' },
      )
    }
    if (body.operation === 'acknowledge') {
      if (body.runId !== body.launchId)
        return conflict(
          'This contract binds the logical run identity to the launch identity',
        )
      if (
        row.requestDigest !== body.requestDigest ||
        (row.hostRunId !== null && row.hostRunId !== body.runId)
      )
        return conflict(
          'Launch acknowledgment conflicts with its immutable identity',
        )
      if (row.hostRunId === body.runId)
        return Result.ok({ kind: 'acknowledged', launchId, runId: body.runId })
      const capacity = await tx
        .select()
        .from(executionHostCapacity)
        .where(eq(executionHostCapacity.operatorId, this.#pilotOperatorId))
        .for('update')
      if (capacity[0]?.launchRecordId !== row.id)
        return conflict('Launch has no operator-wide execution reservation')
      if (
        row.status === 'revoked' ||
        row.requestDigest !== body.requestDigest ||
        (row.hostRunId !== null && row.hostRunId !== body.runId)
      )
        return conflict(
          'Launch acknowledgment conflicts with its immutable identity',
        )
      await tx
        .update(executionHostLaunch)
        .set({ status: 'acknowledged', hostRunId: body.runId })
        .where(eq(executionHostLaunch.id, row.id))
      return Result.ok({ kind: 'acknowledged', launchId, runId: body.runId })
    }
    const event = hostEventSchema.parse(body.event)
    if (
      event.hostId !== request.hostId ||
      event.workspaceId !== request.workspaceId ||
      row.hostRunId !== event.runId ||
      event.sourceRevision !== launch.job.sourceRevision ||
      event.at > now
    )
      return conflict('Host event does not match current run scope or time')
    const digest = await executionControlDigest(event)
    if (event.sequence <= row.lastEventSequence) {
      const existing = await tx
        .select()
        .from(executionHostEvent)
        .where(
          and(
            eq(executionHostEvent.launchRecordId, row.id),
            eq(executionHostEvent.sequence, event.sequence),
          ),
        )
      return existing[0]?.digest === digest
        ? Result.ok({
            kind: 'event_recorded',
            launchId,
            sequence: event.sequence,
          })
        : conflict('Host event identity was reused')
    }
    if (event.sequence !== row.lastEventSequence + 1)
      return conflict('Host event sequence has a gap')
    if (
      ['succeeded', 'failed', 'cancelled'].includes(event.state) &&
      (!event.evidenceDigest ||
        (event.state === 'succeeded' && event.reason !== 'verified') ||
        (event.state === 'cancelled' &&
          event.reason !== 'termination_confirmed') ||
        (event.state === 'failed' &&
          ![
            'verification_failed',
            'termination_confirmed',
            'authority_expired',
            'authority_revoked',
            'allowance_unavailable',
          ].includes(event.reason)))
    )
      return conflict('Terminal host events require confirmed process evidence')
    if (row.lastEventAt !== null && event.at < row.lastEventAt.getTime())
      return conflict('Host event time regressed')
    if (row.lastEventSequence > 0) {
      const previous = await tx
        .select()
        .from(executionHostEvent)
        .where(
          and(
            eq(executionHostEvent.launchRecordId, row.id),
            eq(executionHostEvent.sequence, row.lastEventSequence),
          ),
        )
      const previousEvent = hostEventSchema.safeParse(previous[0]?.event)
      if (
        !previousEvent.success ||
        ['succeeded', 'failed', 'cancelled'].includes(previousEvent.data.state)
      )
        return conflict('A terminal or unavailable run state cannot advance')
    }
    await tx.insert(executionHostEvent).values({
      launchRecordId: row.id,
      sequence: event.sequence,
      digest,
      event,
    })
    await tx
      .update(executionHostLaunch)
      .set({
        lastEventSequence: event.sequence,
        lastEventAt: new Date(event.at),
        ...(['succeeded', 'failed', 'cancelled'].includes(event.state)
          ? { terminalAt: new Date(now) }
          : {}),
      })
      .where(eq(executionHostLaunch.id, row.id))
    if (['succeeded', 'failed', 'cancelled'].includes(event.state))
      await tx
        .update(executionHostCapacity)
        .set({ launchRecordId: null, reservedAt: null })
        .where(
          and(
            eq(executionHostCapacity.operatorId, this.#pilotOperatorId),
            eq(executionHostCapacity.launchRecordId, row.id),
          ),
        )
    return Result.ok({
      kind: 'event_recorded',
      launchId,
      sequence: event.sequence,
    })
  }
}
