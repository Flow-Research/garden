import { Context, Effect, Layer } from 'effect'
import { SkillOperationError } from '@garden/core/skills'
import type { Db } from './db'
import { AppRequest } from './effect-context'

export interface DatabaseService {
  readonly db: Db
}

/** Borrows the database client owned and closed by the current AppRequestContext. */
export class Database extends Context.Service<Database, DatabaseService>()(
  '@garden/web/Database',
) {}

export const databaseLayer = Layer.effect(
  Database,
  Effect.gen(function* () {
    const request = yield* AppRequest
    const db = yield* Effect.tryPromise({
      try: () => request.db(),
      catch: (cause) =>
        new SkillOperationError({
          operation: 'open request database',
          message: 'Failed to open the request database.',
          cause,
        }),
    })
    return Database.of({ db })
  }),
)
