/// <reference types="@cloudflare/workers-types" />

import {
  MailSyncAccountId,
  NonEmptyString,
  ProviderObjectId,
  UserId,
} from '@garden/core/mail'
import { Context, Effect, Layer, Schema } from 'effect'
import { CLOUDFLARE_MAIL_PROVIDER, sendCloudflareMail } from './cloudflare.ts'
import {
  GmailApiError,
  GmailSendMessageInput,
  GmailSendMessageResponse,
} from './gmail-client.ts'
import type {
  MailAttachment,
  MailTransportAddress,
  OutboundMail,
} from './model.ts'
import { MailTransport, MailTransportSendError } from './transport.ts'

export const GmailOutboundAccount = Schema.Struct({
  syncAccountId: MailSyncAccountId,
  userId: UserId,
  executorIntegration: NonEmptyString,
  executorConnectionName: NonEmptyString,
})
export interface GmailOutboundAccount extends Schema.Schema.Type<
  typeof GmailOutboundAccount
> {}

export class GmailOutboundGatewayError extends Schema.TaggedErrorClass<GmailOutboundGatewayError>()(
  'GmailOutboundGatewayError',
  {
    operation: Schema.String,
    reason: Schema.Literals([
      'credential_unavailable',
      'credential_resolution_failed',
      'provider_failed',
    ]),
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export interface GmailOutboundGatewayService {
  /** Runs the Gmail client call inside the host's credential-owned scope. */
  readonly send: (
    account: GmailOutboundAccount,
    input: GmailSendMessageInput,
  ) => Effect.Effect<
    GmailSendMessageResponse,
    GmailOutboundGatewayError | GmailApiError
  >
}

/** Executor adapter port; implementations must never return or persist a token. */
export class GmailOutboundGateway extends Context.Service<
  GmailOutboundGateway,
  GmailOutboundGatewayService
>()('@garden/server/GmailOutboundGateway') {}

/** Rejects newline-bearing values before they reach an RFC header. */
const headerValue = (value: string): string => {
  if (/\r|\n/.test(value)) return value.replace(/[\r\n]+/g, ' ').trim()
  return value.trim()
}

/** Encodes arbitrary bytes without relying on Node Buffer in Workers. */
const base64 = (bytes: Uint8Array): string => {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

const base64Text = (value: string): string =>
  base64(new TextEncoder().encode(value))

const wrappedBase64 = (bytes: Uint8Array): string =>
  base64(bytes).match(/.{1,76}/g)?.join('\r\n') ?? ''

const encodedWord = (value: string): string =>
  /^[\x20-\x7e]*$/.test(value)
    ? headerValue(value)
    : `=?UTF-8?B?${base64Text(value)}?=`

const formattedAddress = (value: MailTransportAddress): string =>
  value.name === undefined
    ? `<${headerValue(value.address)}>`
    : `${encodedWord(value.name)} <${headerValue(value.address)}>`

const addressList = (values: ReadonlyArray<MailTransportAddress>): string =>
  values.map(formattedAddress).join(', ')

const contentPart = (
  mediaType: 'text/plain' | 'text/html',
  content: string,
): string =>
  [
    `Content-Type: ${mediaType}; charset=UTF-8`,
    'Content-Transfer-Encoding: base64',
    '',
    wrappedBase64(new TextEncoder().encode(content)),
  ].join('\r\n')

/** Builds the canonical body section, nesting text/html when both are present. */
const messageBody = (mail: OutboundMail, boundarySeed: string): string => {
  if (mail.html === undefined) return contentPart('text/plain', mail.text)
  const boundary = `garden_alt_${boundarySeed}`
  return [
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    contentPart('text/plain', mail.text),
    `--${boundary}`,
    contentPart('text/html', mail.html),
    `--${boundary}--`,
  ].join('\r\n')
}

const attachmentPart = (attachment: MailAttachment): string => {
  const disposition =
    attachment._tag === 'Inline'
      ? `inline; filename="${headerValue(attachment.filename)}"`
      : `attachment; filename="${headerValue(attachment.filename)}"`
  return [
    `Content-Type: ${headerValue(attachment.mediaType)}; name="${headerValue(attachment.filename)}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: ${disposition}`,
    ...(attachment._tag === 'Inline'
      ? [`Content-ID: <${headerValue(attachment.contentId)}>`]
      : []),
    '',
    wrappedBase64(attachment.content),
  ].join('\r\n')
}

/** Serializes one complete RFC 5322 message for Gmail users.messages.send. */
export const gmailRawMessage = (mail: OutboundMail): string => {
  const messageId = mail.headers['Message-ID'] ?? 'garden-message'
  const boundarySeed = messageId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 48)
  const headers = [
    'MIME-Version: 1.0',
    `From: ${formattedAddress(mail.from)}`,
    `To: ${addressList(mail.to)}`,
    ...(mail.cc.length === 0 ? [] : [`Cc: ${addressList(mail.cc)}`]),
    ...(mail.bcc.length === 0 ? [] : [`Bcc: ${addressList(mail.bcc)}`]),
    ...(mail.replyTo === undefined
      ? []
      : [`Reply-To: ${formattedAddress(mail.replyTo)}`]),
    `Subject: ${encodedWord(mail.subject)}`,
    ...Object.entries(mail.headers).map(
      ([name, value]) => `${headerValue(name)}: ${headerValue(value)}`,
    ),
  ]
  const body = messageBody(mail, boundarySeed)
  if (mail.attachments.length === 0) {
    return [...headers, body, ''].join('\r\n')
  }
  const mixedBoundary = `garden_mixed_${boundarySeed}`
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    '',
    `--${mixedBoundary}`,
    body,
    ...mail.attachments.flatMap((attachment) => [
      `--${mixedBoundary}`,
      attachmentPart(attachment),
    ]),
    `--${mixedBoundary}--`,
    '',
  ].join('\r\n')
}

/** Converts RFC bytes into Gmail's unpadded URL-safe base64 representation. */
export const gmailRawBase64Url = (mail: OutboundMail): string =>
  base64Text(gmailRawMessage(mail))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')

/** Builds the dual Cloudflare/Gmail transport used by the durable send Workflow. */
export const makeRoutedMailTransportLayer = (
  cloudflareBinding: SendEmail,
): Layer.Layer<MailTransport, never, GmailOutboundGateway> =>
  Layer.effect(
    MailTransport,
    Effect.gen(function* () {
      const gmail = yield* GmailOutboundGateway
      return MailTransport.of({
        provider: 'routed',
        send: Effect.fn('RoutedMailTransport.send')(function* (request) {
          if (request.route._tag === 'GardenHosted') {
            if (request.route.provider !== CLOUDFLARE_MAIL_PROVIDER) {
              return yield* new MailTransportSendError({
                provider: request.route.provider,
                operation: 'route',
                code: 'UNSUPPORTED_PROVIDER',
                message: 'Garden-hosted sender has no configured transport.',
              })
            }
            return yield* sendCloudflareMail(cloudflareBinding, request.mail)
          }
          const response = yield* gmail
            .send(
              {
                syncAccountId: request.route.syncAccountId,
                userId: request.route.userId,
                executorIntegration: request.route.executorIntegration,
                executorConnectionName:
                  request.route.executorConnectionName,
              },
              GmailSendMessageInput.make({
                raw: gmailRawBase64Url(request.mail),
                ...(request.route.threadId === null
                  ? {}
                  : { threadId: request.route.threadId }),
              }),
            )
            .pipe(
              Effect.mapError(
                (cause) =>
                  new MailTransportSendError({
                    provider: 'gmail',
                    operation: 'send',
                    message: cause.message,
                    code:
                      cause._tag === 'GmailApiError'
                        ? cause.reason.toUpperCase()
                        : cause.reason.toUpperCase(),
                    cause,
                  }),
              ),
            )
          return {
            provider: 'gmail',
            providerMessageId: ProviderObjectId.make(response.id),
          }
        }),
      })
    }),
  )
