import { Result, TaggedError } from 'better-result'
import { sql } from 'drizzle-orm'
import { Effect } from 'effect'
import { createRuntimeDbClient } from '@garden/db/runtime'
import { xResearchDailyUsage } from '@garden/db/schema'
import type { GardenDatabase } from '@garden/db'
import type { AppEnv } from '../env'

export class XBudgetStorageError extends TaggedError('XBudgetStorageError')<{
  message: string
}>() {}
export type XBudgetOutcome =
  | { kind: 'reserved'; reservedMicroUsd: number }
  | { kind: 'exhausted' }
export type XBudgetReservation = (
  subject: string,
  amount: number,
  limit: number,
  day: string,
) => Effect.Effect<XBudgetOutcome, unknown>

/** One conditional UPSERT holds a PostgreSQL row lock across concurrent calls.
 * Executor's D1 adapter has interactiveTransactions:false; read-then-write in
 * plugin storage would let overlapping MCP sessions exceed the daily cap.
 * Reservations include worst-case reads and are never refunded on failures. */
export function reserveXBudget(
  db: Pick<GardenDatabase, 'insert'>,
  subject: string,
  amount: number,
  limit: number,
  day: string,
) {
  if (
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    !Number.isSafeInteger(limit) ||
    limit > 2_147_483_647 ||
    amount > limit
  ) {
    return Promise.resolve(Result.ok<XBudgetOutcome>({ kind: 'exhausted' }))
  }
  return Result.tryPromise({
    try: () =>
      db
        .insert(xResearchDailyUsage)
        .values({ userId: subject, day, reservedMicroUsd: amount })
        .onConflictDoUpdate({
          target: [xResearchDailyUsage.userId, xResearchDailyUsage.day],
          set: {
            reservedMicroUsd: sql`${xResearchDailyUsage.reservedMicroUsd} + ${amount}`,
          },
          setWhere: sql`${xResearchDailyUsage.reservedMicroUsd} + ${amount} <= ${limit}`,
        })
        .returning({ reservedMicroUsd: xResearchDailyUsage.reservedMicroUsd }),
    catch: () =>
      new XBudgetStorageError({
        message: 'X budget storage is unavailable; no request was sent.',
      }),
  }).then((result) =>
    result.map(
      (rows): XBudgetOutcome =>
        rows[0]
          ? { kind: 'reserved', reservedMicroUsd: rows[0].reservedMicroUsd }
          : { kind: 'exhausted' },
    ),
  )
}

/** MCP sessions outlive HTTP requests, so open and close the main DB client
 * within each reservation instead of retaining request-bound Hyperdrive I/O. */
export function makeXBudgetReservation(
  env: Pick<AppEnv, 'HYPERDRIVE'>,
): XBudgetReservation {
  return (subject, amount, limit, day) =>
    Effect.acquireUseRelease(
      Effect.tryPromise({
        try: () => createRuntimeDbClient(env.HYPERDRIVE),
        catch: () =>
          new XBudgetStorageError({
            message: 'X budget storage is unavailable; no request was sent.',
          }),
      }),
      (client) =>
        Effect.promise(() =>
          reserveXBudget(client.db, subject, amount, limit, day),
        ).pipe(
          Effect.flatMap((result) =>
            result.match<Effect.Effect<XBudgetOutcome, XBudgetStorageError>>({
              ok: (outcome) => Effect.succeed(outcome),
              err: (error) => Effect.fail(error),
            }),
          ),
        ),
      (client) => Effect.promise(() => client.close()),
    )
}

/** Deployment configuration is shared by HTTP Executor calls and hosted MCP. */
export function xResearchRuntimeOptions(
  env: Pick<
    AppEnv,
    | 'HYPERDRIVE'
    | 'X_RESEARCH_DAILY_BUDGET_MICROUSD'
    | 'X_RESEARCH_POST_PRICE_MICROUSD'
    | 'X_RESEARCH_USER_PRICE_MICROUSD'
  >,
) {
  return {
    reserve: makeXBudgetReservation(env),
    dailyBudgetMicroUsd: env.X_RESEARCH_DAILY_BUDGET_MICROUSD,
    postPriceMicroUsd: env.X_RESEARCH_POST_PRICE_MICROUSD,
    userPriceMicroUsd: env.X_RESEARCH_USER_PRICE_MICROUSD,
  }
}
