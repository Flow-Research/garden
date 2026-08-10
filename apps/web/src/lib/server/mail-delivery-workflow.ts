import { WorkflowEntrypoint } from 'cloudflare:workers'
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import type { RequestDraftDeliveryInput } from '@garden/core/mail'
import {
  MailDelivery,
  MailDeliveryResult,
  mailDeliveryLayer,
  makeCloudflareMailTransportLayer,
  makeMailRepositoryLayer,
  makeR2MailObjectStoreLayer,
  type MailDeliverySubmission,
  type PreparedDelivery,
} from '@garden/server/mail'
import { Effect, Layer } from 'effect'
import type { AppEnv } from './env'
import { createRequestDbProvider } from './db'

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
  program: Effect.Effect<A, unknown, MailDelivery>,
): Promise<A> => {
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
          makeCloudflareMailTransportLayer(env.EMAIL),
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
        Effect.flatMap(MailDelivery, (delivery) =>
          delivery.submitPrepared(prepared),
        ),
      ),
    )
    return await step.do('complete', () =>
      runMailDeliveryStep(
        this.env,
        Effect.flatMap(MailDelivery, (delivery) =>
          delivery.completePrepared(prepared, submission),
        ),
      ),
    )
  }
}
