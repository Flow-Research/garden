import {
  EmailAddress,
  InboundMailEnvelope,
  IngestedMail,
  ProviderEvidence,
  ProviderKey,
  UtcTimestamp,
} from '@garden/core/mail'
import { Clock, Context, Effect, Layer } from 'effect'
import { CLOUDFLARE_MAIL_PROVIDER } from './cloudflare.ts'
import {
  MailContentHashError,
  attachmentStorageKey,
  inboundProviderMessageId,
  rawMailStorageKey,
  sha256,
} from './content-addressing.ts'
import {
  MailMimeParseError,
  MailMimeValidationError,
  parseNormalizedMime,
} from './mime.ts'
import type { NormalizedInboundMail } from './model.ts'
import { MailObjectStore, MailObjectWriteError } from './object-store.ts'
import { MailRepository, type MailRepositoryError } from './repository.ts'

export type MailIngressError =
  | MailContentHashError
  | MailMimeParseError
  | MailMimeValidationError
  | MailObjectWriteError
  | MailRepositoryError

export interface MailIngressService {
  readonly ingest: (
    inbound: NormalizedInboundMail,
  ) => Effect.Effect<IngestedMail, MailIngressError>
}

/** Effect application boundary for accepting provider-normalized inbound mail. */
export class MailIngress extends Context.Service<
  MailIngress,
  MailIngressService
>()('@garden/server/MailIngress') {}

/** Provider evidence remains diagnostic metadata, never canonical content. */
const inboundProviderEvidence = (
  inbound: NormalizedInboundMail,
): ProviderEvidence =>
  ProviderEvidence.make({
    envelopeFrom: inbound.envelopeFrom,
    envelopeTo: inbound.envelopeTo,
    headers: inbound.headers.map((header) => ({
      name: header.name,
      value: header.value,
    })),
    rawSize: inbound.rawSize,
  })

/**
 * Parses, content-addresses, stores, and atomically projects one normalized
 * provider delivery. The address is resolved before blob writes, so unknown
 * destinations can be rejected without retaining their content.
 */
export const ingestNormalizedMail = Effect.fn('MailIngress.ingest')(function* (
  inbound: NormalizedInboundMail,
) {
  const repository = yield* MailRepository
  const objectStore = yield* MailObjectStore
  const localRoute = yield* repository.resolveLocalAddress({
    address: EmailAddress.make(inbound.envelopeTo.toLowerCase()),
  })
  const parsed = yield* parseNormalizedMime(inbound)
  const rawHash = yield* sha256(inbound.raw)
  const providerMessageId = inboundProviderMessageId(rawHash)
  const rawStorageKey = rawMailStorageKey(localRoute.workspaceId, rawHash)

  yield* objectStore.put({
    key: rawStorageKey,
    content: inbound.raw,
    contentType: 'message/rfc822',
  })

  const attachments = yield* Effect.forEach(parsed.attachments, (attachment) =>
    Effect.gen(function* () {
      const contentHash = yield* sha256(attachment.content)
      const storageKey = attachmentStorageKey(
        localRoute.workspaceId,
        rawHash,
        contentHash,
        attachment.position,
      )
      yield* objectStore.put({
        key: storageKey,
        content: attachment.content,
        contentType: attachment.contentType,
      })
      return {
        storageKey,
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        sizeBytes: attachment.sizeBytes,
        contentHash,
        disposition: attachment.disposition,
        contentId: attachment.contentId,
        position: attachment.position,
      }
    }),
  )
  const receivedAt = UtcTimestamp.make(
    new Date(yield* Clock.currentTimeMillis).toISOString(),
  )

  const envelope = InboundMailEnvelope.make({
    workspaceId: localRoute.workspaceId,
    provider: ProviderKey.make(CLOUDFLARE_MAIL_PROVIDER),
    providerMessageId,
    providerEvidence: inboundProviderEvidence(inbound),
    rawStorageKey,
    internetMessageId: parsed.internetMessageId,
    inReplyToMessageId: parsed.inReplyToMessageId,
    referenceMessageIds: parsed.referenceMessageIds,
    author: { _tag: 'External' },
    senderName: parsed.sender.displayName,
    senderAddress: parsed.sender.address,
    replyTo: parsed.replyTo.map((address, position) => ({
      position,
      displayName: address.displayName,
      address: address.address,
    })),
    recipients: parsed.recipients,
    localRecipients: [
      {
        localAddressId: localRoute.localAddressId,
        envelopeAddress: localRoute.envelopeAddress,
        providerRecipientId: null,
        providerEvidence: ProviderEvidence.make({
          matchedBy: localRoute.matchedBy,
          addressKind: localRoute.addressKind,
        }),
      },
    ],
    subject: parsed.subject,
    textBody: parsed.textBody,
    htmlBody: parsed.htmlBody,
    attachments,
    authoredAt: parsed.authoredAt ?? receivedAt,
    receivedAt,
  })

  return yield* repository.ingestInbound(envelope)
})

export const mailIngressLayer = Layer.effect(
  MailIngress,
  Effect.gen(function* () {
    const repository = yield* MailRepository
    const objectStore = yield* MailObjectStore

    return MailIngress.of({
      ingest: (inbound) =>
        ingestNormalizedMail(inbound).pipe(
          Effect.provideService(MailRepository, repository),
          Effect.provideService(MailObjectStore, objectStore),
        ),
    })
  }),
)
