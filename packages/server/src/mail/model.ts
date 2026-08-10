import { Schema } from 'effect'

/** Provider-neutral wire participant retained by Garden rather than a transport SDK. */
export const MailTransportAddress = Schema.Struct({
  address: Schema.NonEmptyString,
  name: Schema.optionalKey(Schema.NonEmptyString),
})
export interface MailTransportAddress extends Schema.Schema.Type<
  typeof MailTransportAddress
> {}

/** Outbound attachment content is binary so transports decide their wire encoding. */
export const MailAttachment = Schema.TaggedUnion({
  Attachment: {
    filename: Schema.NonEmptyString,
    mediaType: Schema.NonEmptyString,
    content: Schema.Uint8Array,
  },
  Inline: {
    filename: Schema.NonEmptyString,
    mediaType: Schema.NonEmptyString,
    content: Schema.Uint8Array,
    contentId: Schema.NonEmptyString,
  },
})
export type MailAttachment = typeof MailAttachment.Type

/** Complete transport request produced only after Garden policy authorizes a send. */
export const OutboundMail = Schema.Struct({
  from: MailTransportAddress,
  to: Schema.NonEmptyArray(MailTransportAddress),
  cc: Schema.Array(MailTransportAddress),
  bcc: Schema.Array(MailTransportAddress),
  replyTo: Schema.optionalKey(MailTransportAddress),
  subject: Schema.String,
  text: Schema.String,
  html: Schema.optionalKey(Schema.String),
  headers: Schema.Record(Schema.String, Schema.String),
  attachments: Schema.Array(MailAttachment),
})
export interface OutboundMail extends Schema.Schema.Type<typeof OutboundMail> {}

/** Provider acknowledgement; delivery and bounce state remain later events. */
export const MailSendReceipt = Schema.Struct({
  provider: Schema.NonEmptyString,
  providerMessageId: Schema.NonEmptyString,
})
export interface MailSendReceipt extends Schema.Schema.Type<
  typeof MailSendReceipt
> {}

/** Header snapshot accompanies exact raw MIME bytes for lossless Garden ingest. */
export const InboundMailHeader = Schema.Struct({
  name: Schema.String,
  value: Schema.String,
})
export interface InboundMailHeader extends Schema.Schema.Type<
  typeof InboundMailHeader
> {}

/** Buffered Cloudflare ingress value safe to pass beyond the single-use handler. */
export const NormalizedInboundMail = Schema.Struct({
  envelopeFrom: Schema.String,
  envelopeTo: Schema.NonEmptyString,
  headers: Schema.Array(InboundMailHeader),
  raw: Schema.Uint8Array,
  rawSize: Schema.Natural,
})
export interface NormalizedInboundMail extends Schema.Schema.Type<
  typeof NormalizedInboundMail
> {}
