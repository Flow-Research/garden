import { WorkflowEntrypoint } from 'cloudflare:workers'
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import type { RequestDraftDeliveryInput } from '@garden/core/mail'
import {
  GmailOutboundGateway,
  GmailOutboundGatewayError,
  MailDelivery,
  MailDeliveryResult,
  mailDeliveryLayer,
  makeRoutedMailTransportLayer,
  makeMailRepositoryLayer,
  makeR2MailObjectStoreLayer,
  type MailDeliverySubmission,
  type PreparedDelivery,
} from '@garden/server/mail'
import { Effect, Layer } from 'effect'
import type { AppEnv } from './env'
import { bindAppEnv } from './env'
import { createRequestDbProvider } from './db'
import {
  gmailPersonalConnectionRef,
  withExecutorGmailClient,
} from './executor-engine/gmail-mail-import-plugin'
import { executorProgram } from './executor-runtime'

export type MailDeliveryWorkflowParams = RequestDraftDeliveryInput
export type MailDeliveryWorkflowResult = typeof MailDeliveryResult.Type

/**
 * Runs one Workflow step with a fresh Hyperdrive connection. Cloudflare's
 * Workflow rules require connection setup inside each step because retries may
 * execute in a different isolate; the provider submission output is therefore
 * checkpointed before the independently retriable completion write.
 */
const runMailDeliveryStep = <A>(
  env: AppEnv,
  workspaceId: string,
  program: Effect.Effect<A, unknown, MailDelivery>,
): Promise<A> => {
  bindAppEnv(env)
  const provider = createRequestDbProvider(env)
  return Effect.runPromise(
    Effect.acquireUseRelease(
      Effect.tryPromise({
        try: () => provider.db(),
        catch: (cause) => cause,
      }),
      (db) => {
        const gmailGateway = Layer.succeed(
          GmailOutboundGateway,
          GmailOutboundGateway.of({
            send: (account, input) =>
              executorProgram(
                { tenant: workspaceId, subject: account.userId },
                (executor) =>
                  withExecutorGmailClient(
                    executor.gmailMailImport,
                    gmailPersonalConnectionRef(account.executorConnectionName),
                    (gmail) => gmail.sendMessage(input),
                  ),
              ).pipe(
                Effect.mapError((cause) =>
                  cause._tag === 'GmailApiError'
                    ? cause
                    : new GmailOutboundGatewayError({
                        operation: 'send',
                        reason:
                          cause._tag === 'GmailCredentialBridgeError'
                            ? cause.reason === 'credential_unavailable'
                              ? 'credential_unavailable'
                              : 'credential_resolution_failed'
                            : 'credential_resolution_failed',
                        message:
                          'Garden could not use the connected Gmail account.',
                        cause,
                      }),
                ),
              ),
          }),
        )
        const dependencies = Layer.mergeAll(
          makeMailRepositoryLayer(db),
          makeR2MailObjectStoreLayer(env.FILES),
          makeRoutedMailTransportLayer(env.EMAIL).pipe(
            Layer.provide(gmailGateway),
          ),
        )
        const application = mailDeliveryLayer.pipe(Layer.provide(dependencies))
        return program.pipe(
          Effect.provide(Layer.merge(dependencies, application)),
        )
      },
      () => Effect.promise(() => provider.close()),
    ),
  )
}

/**
 * Durable outbound mail executor. `submit` is the only provider side effect;
 * Cloudflare persists its serializable result before `complete` can retry, so a
 * Postgres failure after acceptance cannot invoke Email Service a second time.
 */
export class MailDeliveryWorkflow extends WorkflowEntrypoint<
  AppEnv,
  MailDeliveryWorkflowParams
> {
  override async run(
    event: Readonly<WorkflowEvent<MailDeliveryWorkflowParams>>,
    step: WorkflowStep,
  ): Promise<MailDeliveryWorkflowResult> {
    const preparation = await step.do('prepare', () =>
      runMailDeliveryStep(
        this.env,
        event.payload.workspaceId,
        Effect.flatMap(MailDelivery, (delivery) =>
          delivery.prepare(event.payload),
        ),
      ),
    )
    if (preparation._tag === 'AlreadySent') {
      return MailDeliveryResult.cases.AlreadySent.make({
        draftId: preparation.draftId,
        messageId: preparation.messageId,
        providerMessageId: preparation.providerMessageId,
      })
    }
    if (preparation._tag === 'InFlight') {
      return MailDeliveryResult.cases.InFlight.make({
        draftId: preparation.draftId,
        messageId: preparation.messageId,
      })
    }

    const prepared: PreparedDelivery = preparation.delivery
    const submission: MailDeliverySubmission = await step.do('submit', () =>
      runMailDeliveryStep(
        this.env,
        event.payload.workspaceId,
        Effect.flatMap(MailDelivery, (delivery) =>
          delivery.submitPrepared(prepared),
        ),
      ),
    )
    return await step.do('complete', () =>
      runMailDeliveryStep(
        this.env,
        event.payload.workspaceId,
        Effect.flatMap(MailDelivery, (delivery) =>
          delivery.completePrepared(prepared, submission),
        ),
      ),
    )
  }
}
