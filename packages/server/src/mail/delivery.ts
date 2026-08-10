import {
  DraftId,
  MessageId,
  ProviderKey,
  ProviderObjectId,
  RequestDraftDeliveryInput,
  UtcTimestamp,
} from '@garden/core/mail'
import { Clock, Context, Effect, Layer, Schema } from 'effect'
import { sha256 } from './content-addressing.ts'
import { OutboundMail, type MailAttachment } from './model.ts'
import { MailObjectStore, type MailObjectStoreService } from './object-store.ts'
import {
  DeliveryPreparation,
  MailRepository,
  type MailRepositoryError,
  type PreparedDelivery,
} from './repository.ts'
import { MailTransport, MailTransportSendError } from './transport.ts'

export const MailDeliveryResult = Schema.TaggedUnion({
  Sent: {
    draftId: DraftId,
    messageId: MessageId,
    providerMessageId: ProviderObjectId,
  },
  AlreadySent: {
    draftId: DraftId,
    messageId: MessageId,
    providerMessageId: Schema.NullOr(ProviderObjectId),
  },
  InFlight: {
    draftId: DraftId,
    messageId: MessageId,
  },
  Failed: {
    draftId: DraftId,
    messageId: MessageId,
    code: Schema.NullOr(Schema.String),
    message: Schema.String,
  },
})
export type MailDeliveryResult = typeof MailDeliveryResult.Type

/** Serializable network-step result cached by a durable workflow step. */
export const MailDeliverySubmission = Schema.TaggedUnion({
  Accepted: {
    provider: ProviderKey,
    providerMessageId: ProviderObjectId,
    occurredAt: UtcTimestamp,
  },
  Failed: {
    provider: ProviderKey,
    code: Schema.NullOr(Schema.String),
    message: Schema.String,
    occurredAt: UtcTimestamp,
  },
})
export type MailDeliverySubmission = typeof MailDeliverySubmission.Type

/** Attachment bytes were absent, corrupt, or inconsistent with immutable metadata. */
export class MailDeliveryContentError extends Schema.TaggedErrorClass<MailDeliveryContentError>()(
  'MailDeliveryContentError',
  {
    draftId: DraftId,
    messageId: MessageId,
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export type MailDeliveryError = MailRepositoryError

export interface MailDeliveryService {
  /** Transactionally reserves immutable content and one delivery attempt. */
  readonly prepare: (
    input: RequestDraftDeliveryInput,
  ) => Effect.Effect<DeliveryPreparation, MailRepositoryError>
  /** Performs the sole network side effect and returns a workflow-cacheable outcome. */
  readonly submitPrepared: (
    delivery: PreparedDelivery,
  ) => Effect.Effect<MailDeliverySubmission>
  /** Persists a cached submission outcome; safe to retry without sending again. */
  readonly completePrepared: (
    delivery: PreparedDelivery,
    submission: MailDeliverySubmission,
  ) => Effect.Effect<MailDeliveryResult, MailRepositoryError>
  /** Convenience composition for synchronous callers; workflows use the split phases. */
  readonly deliver: (
    input: RequestDraftDeliveryInput,
  ) => Effect.Effect<MailDeliveryResult, MailDeliveryError>
}

/** Workflow-callable outbound application service; Effect owns every phase. */
export class MailDelivery extends Context.Service<
  MailDelivery,
  MailDeliveryService
>()('@garden/server/MailDelivery') {}

/** Reads the active Effect clock as Garden's serializable UTC timestamp. */
const nowTimestamp = Effect.fn('MailDelivery.nowTimestamp')(function* () {
  return UtcTimestamp.make(
    new Date(yield* Clock.currentTimeMillis).toISOString(),
  )
})

/** Canonicalizes stored ids before emitting RFC angle-bracket header syntax. */
const rfcMessageId = (value: string): string =>
  `<${value.trim().replace(/^<+|>+$/g, '')}>`

/** Converts persisted display names into the transport's optional-name shape. */
const transportAddress = (address: {
  readonly displayName: string | null
  readonly address: string
}) => {
  const name = address.displayName?.trim()
  return name === undefined || name.length === 0
    ? { address: address.address }
    : { address: address.address, name }
}

/** Reads and verifies every attachment before any network side effect occurs. */
const loadTransportAttachments = Effect.fn(
  'MailDelivery.loadTransportAttachments',
)(function* (store: MailObjectStoreService, delivery: PreparedDelivery) {
  return yield* Effect.forEach(delivery.attachments, (attachment) =>
    Effect.gen(function* () {
      const object = yield* store.get(attachment.storageKey)
      if (object.content.byteLength !== attachment.sizeBytes) {
        return yield* new MailDeliveryContentError({
          draftId: delivery.draftId,
          messageId: delivery.messageId,
          operation: 'verifyAttachmentSize',
          message: 'Stored attachment size differs from immutable metadata.',
        })
      }
      const contentHash = yield* sha256(object.content)
      if (contentHash !== attachment.contentHash) {
        return yield* new MailDeliveryContentError({
          draftId: delivery.draftId,
          messageId: delivery.messageId,
          operation: 'verifyAttachmentHash',
          message: 'Stored attachment hash differs from immutable metadata.',
        })
      }
      if (attachment.disposition === 'inline') {
        if (attachment.contentId === null) {
          return yield* new MailDeliveryContentError({
            draftId: delivery.draftId,
            messageId: delivery.messageId,
            operation: 'buildInlineAttachment',
            message: 'Inline attachment is missing its content id.',
          })
        }
        return {
          _tag: 'Inline',
          filename: attachment.fileName,
          mediaType: attachment.contentType,
          content: object.content,
          contentId: attachment.contentId,
        } satisfies MailAttachment
      }
      return {
        _tag: 'Attachment',
        filename: attachment.fileName,
        mediaType: attachment.contentType,
        content: object.content,
      } satisfies MailAttachment
    }),
  )
})

/** Builds the provider-neutral wire request, including stable reply headers. */
const buildOutboundMail = Effect.fn('MailDelivery.buildOutboundMail')(
  function* (store: MailObjectStoreService, delivery: PreparedDelivery) {
    const attachments = yield* loadTransportAttachments(store, delivery).pipe(
      Effect.mapError((cause) =>
        cause instanceof MailDeliveryContentError
          ? cause
          : new MailDeliveryContentError({
              draftId: delivery.draftId,
              messageId: delivery.messageId,
              operation: 'loadAttachment',
              message: 'Outbound attachment content could not be loaded.',
              cause,
            }),
      ),
    )
    const headers: Record<string, string> = {
      'Message-ID': rfcMessageId(delivery.internetMessageId),
    }
    if (delivery.inReplyToMessageId !== null) {
      headers['In-Reply-To'] = rfcMessageId(delivery.inReplyToMessageId)
    }
    if (delivery.referenceMessageIds.length > 0) {
      headers.References = delivery.referenceMessageIds
        .map(rfcMessageId)
        .join(' ')
    }
    return yield* Schema.decodeUnknownEffect(OutboundMail)({
      from: transportAddress(delivery.from),
      to: delivery.to.map(transportAddress),
      cc: delivery.cc.map(transportAddress),
      bcc: delivery.bcc.map(transportAddress),
      subject: delivery.subject,
      text: delivery.textBody ?? '',
      ...(delivery.htmlBody === null ? {} : { html: delivery.htmlBody }),
      headers,
      attachments,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new MailDeliveryContentError({
            draftId: delivery.draftId,
            messageId: delivery.messageId,
            operation: 'buildOutboundMail',
            message:
              'Materialized message cannot form a valid transport request.',
            cause,
          }),
      ),
    )
  },
)

/** Production layer; repository, object store, and transport remain explicit authority. */
export const mailDeliveryLayer: Layer.Layer<
  MailDelivery,
  never,
  MailRepository | MailObjectStore | MailTransport
> = Layer.effect(
  MailDelivery,
  Effect.gen(function* () {
    const repository = yield* MailRepository
    const store = yield* MailObjectStore
    const transport = yield* MailTransport
    const provider = ProviderKey.make(transport.provider)

    const prepare = Effect.fn('MailDelivery.prepare')(
      (input: RequestDraftDeliveryInput) =>
        repository.prepareDraftDelivery({
          ...input,
          provider,
        }),
    )

    const submitPrepared = Effect.fn('MailDelivery.submitPrepared')(function* (
      delivery: PreparedDelivery,
    ) {
      if (delivery.provider !== provider) {
        return MailDeliverySubmission.cases.Failed.make({
          provider,
          message: 'Prepared delivery belongs to a different transport.',
          code: 'PROVIDER_MISMATCH',
          occurredAt: yield* nowTimestamp(),
        })
      }

      const outbound = yield* buildOutboundMail(store, delivery).pipe(
        Effect.map((outbound) => ({ _tag: 'Ready' as const, outbound })),
        Effect.catch((cause) =>
          nowTimestamp().pipe(
            Effect.map((occurredAt) => ({
              _tag: 'Failed' as const,
              submission: MailDeliverySubmission.cases.Failed.make({
                provider,
                code: 'CONTENT_UNAVAILABLE',
                message: cause.message,
                occurredAt,
              }),
            })),
          ),
        ),
      )
      if (outbound._tag === 'Failed') return outbound.submission
      const submitted = yield* transport.send(outbound.outbound).pipe(
        Effect.map((receipt) => ({ _tag: 'Accepted' as const, receipt })),
        Effect.catch((cause: MailTransportSendError) =>
          nowTimestamp().pipe(
            Effect.map((occurredAt) => ({
              _tag: 'Failed' as const,
              submission: MailDeliverySubmission.cases.Failed.make({
                provider,
                code: cause.code ?? null,
                message: cause.message,
                occurredAt,
              }),
            })),
          ),
        ),
      )
      if (submitted._tag === 'Failed') return submitted.submission
      if (submitted.receipt.provider !== provider) {
        return MailDeliverySubmission.cases.Failed.make({
          provider,
          message: 'Transport returned a receipt for a different provider.',
          code: 'PROVIDER_MISMATCH',
          occurredAt: yield* nowTimestamp(),
        })
      }
      return MailDeliverySubmission.cases.Accepted.make({
        provider,
        providerMessageId: ProviderObjectId.make(
          submitted.receipt.providerMessageId,
        ),
        occurredAt: yield* nowTimestamp(),
      })
    })

    const completePrepared = Effect.fn('MailDelivery.completePrepared')(
      function* (
        delivery: PreparedDelivery,
        submission: MailDeliverySubmission,
      ) {
        const recordFailure = Effect.fn('MailDelivery.recordFailure')(
          function* (
            failedSubmission: Extract<
              MailDeliverySubmission,
              { readonly _tag: 'Failed' }
            >,
          ) {
            yield* repository.failDraftDelivery({
              workspaceId: delivery.workspaceId,
              draftId: delivery.draftId,
              messageId: delivery.messageId,
              attemptId: delivery.attemptId,
              provider: delivery.provider,
              failureCode: failedSubmission.code,
              failureMessage: failedSubmission.message,
              occurredAt: failedSubmission.occurredAt,
            })
            return MailDeliveryResult.cases.Failed.make({
              draftId: delivery.draftId,
              messageId: delivery.messageId,
              code: failedSubmission.code,
              message: failedSubmission.message,
            })
          },
        )
        if (submission.provider !== delivery.provider) {
          return yield* recordFailure(
            MailDeliverySubmission.cases.Failed.make({
              provider: delivery.provider,
              code: 'PROVIDER_MISMATCH',
              message: 'Submission belongs to a different provider.',
              occurredAt: submission.occurredAt,
            }),
          )
        }
        if (submission._tag === 'Failed') {
          return yield* recordFailure(submission)
        }
        yield* repository.completeDraftDelivery({
          workspaceId: delivery.workspaceId,
          draftId: delivery.draftId,
          messageId: delivery.messageId,
          attemptId: delivery.attemptId,
          provider: delivery.provider,
          providerMessageId: submission.providerMessageId,
          occurredAt: submission.occurredAt,
        })
        return MailDeliveryResult.cases.Sent.make({
          draftId: delivery.draftId,
          messageId: delivery.messageId,
          providerMessageId: submission.providerMessageId,
        })
      },
    )

    const deliver = Effect.fn('MailDelivery.deliver')(function* (
      input: RequestDraftDeliveryInput,
    ) {
      const preparation = yield* prepare(input)
      if (preparation._tag === 'Ready') {
        const submission = yield* submitPrepared(preparation.delivery)
        return yield* completePrepared(preparation.delivery, submission)
      }
      if (preparation._tag === 'InFlight') {
        return MailDeliveryResult.cases.InFlight.make({
          draftId: preparation.draftId,
          messageId: preparation.messageId,
        })
      }
      return MailDeliveryResult.cases.AlreadySent.make({
        draftId: preparation.draftId,
        messageId: preparation.messageId,
        providerMessageId: preparation.providerMessageId,
      })
    })

    return MailDelivery.of({
      prepare,
      submitPrepared,
      completePrepared,
      deliver,
    })
  }),
)
