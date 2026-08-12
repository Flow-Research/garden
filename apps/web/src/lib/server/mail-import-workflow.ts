import { WorkflowEntrypoint } from 'cloudflare:workers'
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import {
  MailSyncItemSettlement,
  MemberId,
  ProviderObjectId,
  UserId,
  type MailSyncAccount,
  type MailSyncItem,
  type MailSyncRun,
  type MailSyncRunId,
  type WorkspaceId,
} from '@garden/core/mail'
import {
  GmailImport,
  MailRepository,
  gmailImportLayer,
  makeMailRepositoryLayer,
  makeR2MailObjectStoreLayer,
  type GmailClientService,
  type GmailImportService,
  type MailRepositoryService,
} from '@garden/server/mail'
import { Effect, Layer } from 'effect'
import {
  gmailPersonalConnectionRef,
  withExecutorGmailClient,
} from './executor-engine/gmail-mail-import-plugin'
import { executorProgram } from './executor-runtime'
import type { AppEnv } from './env'
import { bindAppEnv } from './env'
import { createRequestDbProvider } from './db'

const GMAIL_ENUMERATION_PAGE_SIZE = 500
const GMAIL_IMPORT_BATCH_SIZE = 10

export type GmailImportWorkflowParams = {
  workspaceId: WorkspaceId
  runId: MailSyncRunId
  syncAccountId: MailSyncAccount['id']
  userId: typeof UserId.Type
  memberId: typeof MemberId.Type
}

export type GmailImportWorkflowResult =
  | {
      status: 'completed'
      run: MailSyncRun
    }
  | {
      status: 'failed'
      runId: MailSyncRunId
      message: string
    }

type StepOutcome<A> =
  | { readonly _tag: 'Success'; readonly value: A }
  | { readonly _tag: 'Failure'; readonly message: string }

type GmailWorkflowServices = {
  readonly gmail: GmailClientService
  readonly repository: MailRepositoryService
  readonly importer: GmailImportService
}

type HistoryEnumerationPage = {
  readonly nextPageToken: string | null
  readonly historyId: string
  readonly expired: boolean
}

/**
 * Collapses Gmail history categories into one durable message workset.
 * Label-only changes re-fetch the same RAW object to reconcile canonical state.
 */
const historyWorkItems = (
  history: ReadonlyArray<{
    readonly messagesAdded?: ReadonlyArray<{
      readonly message: { readonly id: string; readonly threadId: string }
    }>
    readonly labelsAdded?: ReadonlyArray<{
      readonly message: { readonly id: string; readonly threadId: string }
    }>
    readonly labelsRemoved?: ReadonlyArray<{
      readonly message: { readonly id: string; readonly threadId: string }
    }>
  }>,
) => {
  const items = new Map<
    string,
    {
      providerMessageId: typeof ProviderObjectId.Type
      providerThreadId: typeof ProviderObjectId.Type
    }
  >()
  for (const record of history) {
    for (const change of record.messagesAdded ?? []) {
      items.set(change.message.id, {
        providerMessageId: ProviderObjectId.make(change.message.id),
        providerThreadId: ProviderObjectId.make(change.message.threadId),
      })
    }
    for (const change of [
      ...(record.labelsAdded ?? []),
      ...(record.labelsRemoved ?? []),
    ]) {
      items.set(change.message.id, {
        providerMessageId: ProviderObjectId.make(change.message.id),
        providerThreadId: ProviderObjectId.make(change.message.threadId),
      })
    }
  }
  return [...items.values()]
}

/** Keeps Workflow checkpoints useful without serializing defects or private data. */
const workflowErrorMessage = (error: unknown): string => {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.length > 0
  ) {
    return error.message.slice(0, 500)
  }
  return 'Gmail import could not complete this step.'
}

/** Converts expected Effect failures into a small serializable step outcome. */
const checkpointOutcome = <A, E>(
  effect: Effect.Effect<A, E>,
): Effect.Effect<StepOutcome<A>> =>
  effect.pipe(
    Effect.match({
      onFailure: (error): StepOutcome<A> => ({
        _tag: 'Failure',
        message: workflowErrorMessage(error),
      }),
      onSuccess: (value): StepOutcome<A> => ({ _tag: 'Success', value }),
    }),
  )

/** Lets Cloudflare Workflow own finite retry for transient Gmail reads. */
const retryTransientGmailAtWorkflowBoundary = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  effect.pipe(
    Effect.catchIf(
      (error) => {
        if (
          typeof error !== 'object' ||
          error === null ||
          !('_tag' in error) ||
          error._tag !== 'GmailApiError' ||
          !('reason' in error)
        ) {
          return false
        }
        if (error.reason === 'transport') return true
        if (error.reason !== 'rejected' || !('statusCode' in error)) {
          return false
        }
        return (
          error.statusCode === 408 ||
          error.statusCode === 429 ||
          error.statusCode === 500 ||
          error.statusCode === 502 ||
          error.statusCode === 503 ||
          error.statusCode === 504
        )
      },
      (error) => Effect.die(error),
    ),
  )

/**
 * Runs one database-only Workflow checkpoint with a fresh Hyperdrive client.
 * Cloudflare may retry a checkpoint in another isolate, so no connection or
 * transaction crosses a `step.do` boundary.
 */
const runMailImportDatabaseStep = <A, E>(
  env: AppEnv,
  use: (repository: MailRepositoryService) => Effect.Effect<A, E>,
): Promise<StepOutcome<A>> => {
  const provider = createRequestDbProvider(env)
  return Effect.runPromise(
    Effect.acquireUseRelease(
      Effect.tryPromise({
        try: () => provider.db(),
        catch: (cause) => cause,
      }),
      (db) => {
        const layer = makeMailRepositoryLayer(db)
        return Effect.gen(function* () {
          const repository = yield* MailRepository
          return yield* use(repository)
        }).pipe(Effect.provide(layer), checkpointOutcome)
      },
      () => Effect.promise(() => provider.close()),
    ),
  )
}

/**
 * Resolves the Executor credential only inside this request-scoped Effect,
 * supplies Gmail plus Garden persistence services, and returns decoded data.
 * Tokens never enter Workflow payloads, checkpoints, Postgres, or logs.
 */
const runGmailImportStep = <A, E>(
  env: AppEnv,
  params: GmailImportWorkflowParams,
  connectionName: string,
  use: (services: GmailWorkflowServices) => Effect.Effect<A, E>,
): Promise<StepOutcome<A>> => {
  bindAppEnv(env)
  const provider = createRequestDbProvider(env)
  return Effect.runPromise(
    Effect.acquireUseRelease(
      Effect.tryPromise({
        try: () => provider.db(),
        catch: (cause) => cause,
      }),
      (db) => {
        const dependencies = Layer.mergeAll(
          makeMailRepositoryLayer(db),
          makeR2MailObjectStoreLayer(env.FILES),
        )
        const application = gmailImportLayer.pipe(Layer.provide(dependencies))
        const layer = Layer.merge(dependencies, application)
        return executorProgram(
          { tenant: params.workspaceId, subject: params.userId },
          (executor) =>
            withExecutorGmailClient(
              executor.gmailMailImport,
              gmailPersonalConnectionRef(connectionName),
              (gmail) =>
                Effect.gen(function* () {
                  const repository = yield* MailRepository
                  const importer = yield* GmailImport
                  return yield* use({ gmail, repository, importer })
                }).pipe(Effect.provide(layer)),
            ),
        ).pipe(retryTransientGmailAtWorkflowBoundary, checkpointOutcome)
      },
      () => Effect.promise(() => provider.close()),
    ),
  )
}

/** Records product-ledger failure; the DB ledger remains the UI authority. */
const failImportRun = async (
  step: WorkflowStep,
  env: AppEnv,
  params: GmailImportWorkflowParams,
  checkpoint: string,
  message: string,
): Promise<GmailImportWorkflowResult> => {
  await step.do(`fail-${checkpoint}`, () =>
    runMailImportDatabaseStep(env, (repository) =>
      repository.failMailSyncRun({
        workspaceId: params.workspaceId,
        runId: params.runId,
        error: message,
      }),
    ),
  )
  return { status: 'failed', runId: params.runId, message }
}

/** Finds the server-created account without trusting provider identity in params. */
const resolveWorkflowAccount = (
  repository: MailRepositoryService,
  params: GmailImportWorkflowParams,
) =>
  repository
    .listPersonalMailSyncStates({
      workspaceId: params.workspaceId,
      userId: params.userId,
      provider: 'gmail',
    })
    .pipe(
      Effect.flatMap((states) => {
        const state = states.find(
          (state) => state.account?.id === params.syncAccountId,
        )
        if (state?.account === null || state?.account === undefined) {
          return Effect.fail(
            new Error('Connected Gmail import account not found.'),
          )
        }
        if (state.latestRun?.id !== params.runId) {
          return Effect.fail(new Error('Gmail import run is no longer active.'))
        }
        return Effect.succeed({ account: state.account, run: state.latestRun })
      }),
    )

/** Settles one provider item after its canonical import result is known. */
const settleImportedItem = (
  services: GmailWorkflowServices,
  params: GmailImportWorkflowParams,
  account: MailSyncAccount,
  item: MailSyncItem,
) =>
  services.gmail.getRawMessage(item.providerMessageId).pipe(
    Effect.flatMap((message) =>
      services.importer.importMessage({
        workspaceId: params.workspaceId,
        syncAccountId: params.syncAccountId,
        memberId: params.memberId,
        providerEmail: account.providerEmail,
        message,
      }),
    ),
    Effect.map((ingested) =>
      ingested.duplicate
        ? MailSyncItemSettlement.cases.Duplicate.make({
            messageId: ingested.messageId,
          })
        : MailSyncItemSettlement.cases.Imported.make({
            messageId: ingested.messageId,
          }),
    ),
    Effect.catchIf(
      (error) =>
        typeof error === 'object' &&
        error !== null &&
        '_tag' in error &&
        (error._tag === 'GmailImportContentError' ||
          error._tag === 'MailMimeParseError' ||
          error._tag === 'MailMimeValidationError' ||
          (error._tag === 'GmailApiError' &&
            'reason' in error &&
            (error.reason === 'not_found' ||
              error.reason === 'invalid_response'))),
      (error) =>
        Effect.succeed(
          MailSyncItemSettlement.cases.Failed.make({
            error: workflowErrorMessage(error),
          }),
        ),
    ),
    Effect.flatMap((settlement) =>
      services.repository.settleMailSyncItem({
        workspaceId: params.workspaceId,
        runId: params.runId,
        providerMessageId: item.providerMessageId,
        claimKey: item.claimKey ?? `batch-unclaimed-${item.ordinal}`,
        settlement,
      }),
    ),
  )

/**
 * Durable Gmail import and recovery. Initial enumeration intentionally ignores
 * Gmail's estimate: every id is persisted first, SQL freezes the exact
 * denominator, then bounded sequential batches import one RAW message at a
 * time. A recovered frozen run skips enumeration and resumes pending items.
 */
export class GmailImportWorkflow extends WorkflowEntrypoint<
  AppEnv,
  GmailImportWorkflowParams
> {
  override async run(
    event: Readonly<WorkflowEvent<GmailImportWorkflowParams>>,
    step: WorkflowStep,
  ): Promise<GmailImportWorkflowResult> {
    const params = event.payload
    const accountOutcome = await step.do('resolve-account', () =>
      runMailImportDatabaseStep(this.env, (repository) =>
        resolveWorkflowAccount(repository, params),
      ),
    )
    if (accountOutcome._tag === 'Failure') {
      return await failImportRun(
        step,
        this.env,
        params,
        'resolve-account',
        accountOutcome.message,
      )
    }
    const { account, run } = accountOutcome.value

    const profileOutcome = await step.do('gmail-profile', () =>
      runGmailImportStep(
        this.env,
        params,
        account.executorConnectionName,
        ({ gmail }) => gmail.getProfile(),
      ),
    )
    if (profileOutcome._tag === 'Failure') {
      return await failImportRun(
        step,
        this.env,
        params,
        'gmail-profile',
        profileOutcome.message,
      )
    }

    let completionHistoryId = profileOutcome.value.historyId
    if (run.status !== 'importing' && account.historyId !== null) {
      const startHistoryId = account.historyId
      let pageToken: string | undefined
      let pageIndex = 0
      let historyExpired = false
      do {
        const currentToken = pageToken
        const pageOutcome = await step.do(`history-${pageIndex}`, () =>
          runGmailImportStep(
            this.env,
            params,
            account.executorConnectionName,
            ({ gmail, repository }) =>
              gmail
                .listHistory({
                  startHistoryId,
                  maxResults: GMAIL_ENUMERATION_PAGE_SIZE,
                  pageToken: currentToken,
                  historyTypes: ['messageAdded', 'labelAdded', 'labelRemoved'],
                })
                .pipe(
                  Effect.flatMap((page) =>
                    repository
                      .persistMailSyncPage({
                        workspaceId: params.workspaceId,
                        runId: params.runId,
                        items: historyWorkItems(page.history ?? []),
                      })
                      .pipe(
                        Effect.as<HistoryEnumerationPage>({
                          nextPageToken: page.nextPageToken ?? null,
                          historyId: page.historyId,
                          expired: false,
                        }),
                      ),
                  ),
                  Effect.catchIf(
                    (error) =>
                      error._tag === 'GmailApiError' &&
                      error.operation === 'listHistory' &&
                      error.reason === 'not_found',
                    () =>
                      Effect.succeed<HistoryEnumerationPage>({
                        nextPageToken: null,
                        historyId: profileOutcome.value.historyId,
                        expired: true,
                      }),
                  ),
                ),
          ),
        )
        if (pageOutcome._tag === 'Failure') {
          return await failImportRun(
            step,
            this.env,
            params,
            `history-${pageIndex}`,
            pageOutcome.message,
          )
        }
        historyExpired = pageOutcome.value.expired
        completionHistoryId = pageOutcome.value.historyId
        pageToken = pageOutcome.value.nextPageToken ?? undefined
        pageIndex += 1
      } while (pageToken !== undefined)

      if (!historyExpired) {
        const finalizeOutcome = await step.do('freeze-exact-total', () =>
          runMailImportDatabaseStep(this.env, (repository) =>
            repository.finalizeMailSyncEnumeration({
              workspaceId: params.workspaceId,
              runId: params.runId,
            }),
          ),
        )
        if (finalizeOutcome._tag === 'Failure') {
          return await failImportRun(
            step,
            this.env,
            params,
            'freeze-exact-total',
            finalizeOutcome.message,
          )
        }
      }
      if (!historyExpired) {
        // Incremental history has been frozen; do not enumerate the mailbox.
      } else {
        completionHistoryId = profileOutcome.value.historyId
      }
      if (!historyExpired) {
        // Continue directly to the shared durable batch processor below.
      } else {
        let pageToken: string | undefined
        let pageIndex = 0
        do {
          const currentToken = pageToken
          const pageOutcome = await step.do(`rescan-${pageIndex}`, () =>
            runGmailImportStep(
              this.env,
              params,
              account.executorConnectionName,
              ({ gmail, repository }) =>
                Effect.gen(function* () {
                  const page = yield* gmail.listMessages({
                    maxResults: GMAIL_ENUMERATION_PAGE_SIZE,
                    pageToken: currentToken,
                    query: '-in:drafts',
                    includeSpamTrash: false,
                  })
                  yield* repository.persistMailSyncPage({
                    workspaceId: params.workspaceId,
                    runId: params.runId,
                    items: (page.messages ?? []).map((message) => ({
                      providerMessageId: ProviderObjectId.make(message.id),
                      providerThreadId: ProviderObjectId.make(message.threadId),
                    })),
                  })
                  return { nextPageToken: page.nextPageToken ?? null }
                }),
            ),
          )
          if (pageOutcome._tag === 'Failure') {
            return await failImportRun(
              step,
              this.env,
              params,
              `rescan-${pageIndex}`,
              pageOutcome.message,
            )
          }
          pageToken = pageOutcome.value.nextPageToken ?? undefined
          pageIndex += 1
        } while (pageToken !== undefined)
        const finalizeOutcome = await step.do('freeze-rescan-total', () =>
          runMailImportDatabaseStep(this.env, (repository) =>
            repository.finalizeMailSyncEnumeration({
              workspaceId: params.workspaceId,
              runId: params.runId,
            }),
          ),
        )
        if (finalizeOutcome._tag === 'Failure') {
          return await failImportRun(
            step,
            this.env,
            params,
            'freeze-rescan-total',
            finalizeOutcome.message,
          )
        }
      }
    } else if (run.status !== 'importing') {
      let pageToken: string | undefined
      let pageIndex = 0
      do {
        const currentToken = pageToken
        const pageOutcome = await step.do(`enumerate-${pageIndex}`, () =>
          runGmailImportStep(
            this.env,
            params,
            account.executorConnectionName,
            ({ gmail, repository }) =>
              Effect.gen(function* () {
                const page = yield* gmail.listMessages({
                  maxResults: GMAIL_ENUMERATION_PAGE_SIZE,
                  pageToken: currentToken,
                  query: '-in:drafts',
                  includeSpamTrash: false,
                })
                yield* repository.persistMailSyncPage({
                  workspaceId: params.workspaceId,
                  runId: params.runId,
                  items: (page.messages ?? []).map((message) => ({
                    providerMessageId: ProviderObjectId.make(message.id),
                    providerThreadId: ProviderObjectId.make(message.threadId),
                  })),
                })
                return { nextPageToken: page.nextPageToken ?? null }
              }),
          ),
        )
        if (pageOutcome._tag === 'Failure') {
          return await failImportRun(
            step,
            this.env,
            params,
            `enumerate-${pageIndex}`,
            pageOutcome.message,
          )
        }
        pageToken = pageOutcome.value.nextPageToken ?? undefined
        pageIndex += 1
      } while (pageToken !== undefined)

      const finalizeOutcome = await step.do('freeze-exact-total', () =>
        runMailImportDatabaseStep(this.env, (repository) =>
          repository.finalizeMailSyncEnumeration({
            workspaceId: params.workspaceId,
            runId: params.runId,
          }),
        ),
      )
      if (finalizeOutcome._tag === 'Failure') {
        return await failImportRun(
          step,
          this.env,
          params,
          'freeze-exact-total',
          finalizeOutcome.message,
        )
      }
    }

    let batchIndex = 0
    while (true) {
      const claimKey = `batch-${batchIndex}`
      const batchOutcome = await step.do(`claim-${claimKey}`, () =>
        runMailImportDatabaseStep(this.env, (repository) =>
          repository.claimPendingMailSyncBatch({
            workspaceId: params.workspaceId,
            runId: params.runId,
            claimKey,
            limit: GMAIL_IMPORT_BATCH_SIZE,
          }),
        ),
      )
      if (batchOutcome._tag === 'Failure') {
        return await failImportRun(
          step,
          this.env,
          params,
          `claim-${claimKey}`,
          batchOutcome.message,
        )
      }
      if (batchOutcome.value.length === 0) break

      const processOutcome = await step.do(`process-${claimKey}`, () =>
        runGmailImportStep(
          this.env,
          params,
          account.executorConnectionName,
          (services) =>
            Effect.forEach(
              batchOutcome.value,
              (item) =>
                item.status === 'imported' ||
                item.status === 'duplicate' ||
                item.status === 'failed'
                  ? Effect.void
                  : settleImportedItem(services, params, account, item),
              { concurrency: 1, discard: true },
            ),
        ),
      )
      if (processOutcome._tag === 'Failure') {
        return await failImportRun(
          step,
          this.env,
          params,
          `process-${claimKey}`,
          processOutcome.message,
        )
      }
      batchIndex += 1
    }

    const completionOutcome = await step.do('complete-run', () =>
      runMailImportDatabaseStep(this.env, (repository) =>
        repository.completeMailSyncRun({
          workspaceId: params.workspaceId,
          runId: params.runId,
          historyId: ProviderObjectId.make(completionHistoryId),
        }),
      ),
    )
    if (completionOutcome._tag === 'Failure') {
      return await failImportRun(
        step,
        this.env,
        params,
        'complete-run',
        completionOutcome.message,
      )
    }
    return { status: 'completed', run: completionOutcome.value }
  }
}
