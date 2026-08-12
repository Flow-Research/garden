import {
  EmailAddress,
  MailSyncRunId,
  UserId,
  WorkspaceId,
  type MailSyncRun,
  type PersonalMailSyncState,
} from '@garden/core/mail'
import { MailRepository, makeMailRepositoryLayer } from '@garden/server/mail'
import { Effect, Schema } from 'effect'
import type { AppRequestContext } from './context'
import {
  gmailPersonalConnectionRef,
  withExecutorGmailClient,
} from './executor-engine/gmail-mail-import-plugin'
import { executorProgram } from './executor-runtime'
import { requireMailMemberAuthority } from './mail-authority'
import type { GmailImportWorkflowParams } from './mail-import-workflow'

const GOOGLE_GMAIL_INTEGRATION = 'google_gmail'

/** Authenticated request references no usable personal Gmail connection. */
export class GmailImportConnectionError extends Schema.TaggedErrorClass<GmailImportConnectionError>()(
  'GmailImportConnectionError',
  {
    reason: Schema.Literals([
      'not_found',
      'invalid_identity',
      'dispatch_failed',
    ]),
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/** Resolves session identity once for all mail sync operations. */
const requireGmailImportAuthority = Effect.fn('GmailImport.requireAuthority')(
  function* (context: AppRequestContext, rawWorkspaceId: string) {
    const workspaceId =
      yield* Schema.decodeUnknownEffect(WorkspaceId)(rawWorkspaceId)
    const authority = yield* requireMailMemberAuthority(context, workspaceId)
    const session = yield* Effect.tryPromise({
      try: () => context.auth.getSession(),
      catch: (cause) => cause,
    })
    if (!session?.user) {
      return yield* new GmailImportConnectionError({
        reason: 'not_found',
        message: 'Authenticated user could not be resolved.',
      })
    }
    const userId = yield* Schema.decodeUnknownEffect(UserId)(session.user.id)
    return { authority, userId, workspaceId }
  },
)

/** Lists every durable personal Gmail import state for the current user. */
export async function getPersonalGmailImportStates(
  context: AppRequestContext,
  workspaceId: string,
): Promise<ReadonlyArray<PersonalMailSyncState>> {
  return await Effect.runPromise(
    Effect.gen(function* () {
      const identity = yield* requireGmailImportAuthority(context, workspaceId)
      return yield* Effect.gen(function* () {
        const repository = yield* MailRepository
        return yield* repository.listPersonalMailSyncStates({
          workspaceId: identity.workspaceId,
          userId: identity.userId,
          provider: 'gmail',
        })
      }).pipe(Effect.provide(makeMailRepositoryLayer(identity.authority.db)))
    }),
  )
}

/**
 * Verifies the exact user-owned Executor connection and reads Gmail profile
 * identity inside the scoped credential callback. Access tokens cannot escape.
 */
const resolvePersonalGmailConnection = Effect.fn(
  'GmailImport.resolveConnection',
)(function* (input: {
  workspaceId: typeof WorkspaceId.Type
  userId: typeof UserId.Type
  connectionAddress: string
}) {
  return yield* executorProgram(
    { tenant: input.workspaceId, subject: input.userId },
    (executor) =>
      Effect.gen(function* () {
        const connections = yield* executor.connections.list()
        const connection = connections.find(
          (candidate) =>
            String(candidate.address) === input.connectionAddress &&
            candidate.owner === 'user' &&
            String(candidate.integration) === GOOGLE_GMAIL_INTEGRATION,
        )
        if (connection === undefined) {
          return yield* new GmailImportConnectionError({
            reason: 'not_found',
            message: 'Selected personal Gmail connection was not found.',
          })
        }
        const profile = yield* withExecutorGmailClient(
          executor.gmailMailImport,
          gmailPersonalConnectionRef(String(connection.name)),
          (gmail) => gmail.getProfile(),
        )
        const providerEmail = yield* Schema.decodeUnknownEffect(EmailAddress)(
          profile.emailAddress.toLowerCase(),
        ).pipe(
          Effect.mapError(
            (cause) =>
              new GmailImportConnectionError({
                reason: 'invalid_identity',
                message: 'Connected Gmail profile has no valid email address.',
                cause,
              }),
          ),
        )
        return {
          connectionName: String(connection.name),
          providerEmail,
        }
      }),
  )
})

/**
 * Creates one idempotent run ledger then starts its deterministic Cloudflare
 * Workflow. Existing active runs reuse the stored instance id instead of
 * creating competing scans for the same Gmail account.
 */
export async function startPersonalGmailImport(
  context: AppRequestContext,
  input: { workspaceId: string; connectionAddress: string },
): Promise<MailSyncRun> {
  return await Effect.runPromise(
    Effect.gen(function* () {
      const identity = yield* requireGmailImportAuthority(
        context,
        input.workspaceId,
      )
      const connection = yield* resolvePersonalGmailConnection({
        workspaceId: identity.workspaceId,
        userId: identity.userId,
        connectionAddress: input.connectionAddress,
      })
      const repositoryLayer = makeMailRepositoryLayer(identity.authority.db)
      const run = yield* Effect.gen(function* () {
        const repository = yield* MailRepository
        const states = yield* repository.listPersonalMailSyncStates({
          workspaceId: identity.workspaceId,
          userId: identity.userId,
          provider: 'gmail',
        })
        const previous = states.find(
          (state) =>
            state.account?.executorConnectionName === connection.connectionName,
        )
        const account = yield* repository.resolveMailSyncAccount({
          workspaceId: identity.workspaceId,
          userId: identity.userId,
          memberId: identity.authority.actor.memberId,
          provider: 'gmail',
          providerEmail: connection.providerEmail,
          mailboxName: connection.providerEmail,
          executorIntegration: GOOGLE_GMAIL_INTEGRATION,
          executorConnectionName: connection.connectionName,
        })
        const proposedRunId = MailSyncRunId.make(crypto.randomUUID())
        const workflowInstanceId = `gmail-import-${proposedRunId}`
        return yield* repository.startMailSyncRun({
          workspaceId: identity.workspaceId,
          syncAccountId: account.id,
          workflowInstanceId,
          trigger:
            previous === undefined || previous.latestRun === null
              ? 'initial'
              : 'manual',
        })
      }).pipe(Effect.provide(repositoryLayer))

      const params: GmailImportWorkflowParams = {
        workspaceId: identity.workspaceId,
        runId: run.id,
        syncAccountId: run.syncAccountId,
        userId: identity.userId,
        memberId: identity.authority.actor.memberId,
      }
      yield* Effect.tryPromise({
        try: () =>
          context.env.GMAIL_IMPORT_WORKFLOW.create({
            id: run.workflowInstanceId,
            params,
          }),
        catch: (cause) =>
          new GmailImportConnectionError({
            reason: 'dispatch_failed',
            message: 'Garden could not start the Gmail import Workflow.',
            cause,
          }),
      }).pipe(
        Effect.catchTag('GmailImportConnectionError', (createError) =>
          Effect.tryPromise({
            try: () =>
              context.env.GMAIL_IMPORT_WORKFLOW.get(run.workflowInstanceId),
            catch: () => createError,
          }),
        ),
      )
      return run
    }),
  )
}
