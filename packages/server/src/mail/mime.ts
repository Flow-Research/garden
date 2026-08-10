import {
  AttachmentDisposition,
  EmailAddress,
  InternetMessageId,
  NonEmptyString,
  RecipientKind,
} from "@garden/core/mail";
import {
  Array as Arr,
  Effect,
  Encoding,
  Result,
  Schema,
  String as Str,
} from "effect";
import PostalMime from "postal-mime";
import type {
  Address as PostalAddress,
  Attachment as PostalAttachment,
  Email as PostalEmail,
  Mailbox as PostalMailbox,
} from "postal-mime";
import type { NormalizedInboundMail } from "./model.ts";

/** Address decoded from MIME and normalized for Garden's mail domain. */
export const ParsedMimeAddress = Schema.Struct({
  displayName: Schema.NullOr(Schema.String),
  address: EmailAddress,
});
export interface ParsedMimeAddress extends Schema.Schema.Type<
  typeof ParsedMimeAddress
> {}

/** Recipient retains its original envelope role and deterministic position. */
export const ParsedMimeRecipient = Schema.Struct({
  kind: RecipientKind,
  position: Schema.Natural,
  displayName: Schema.NullOr(Schema.String),
  address: EmailAddress,
});
export interface ParsedMimeRecipient extends Schema.Schema.Type<
  typeof ParsedMimeRecipient
> {}

/** Header order and duplicates remain intact for audit and troubleshooting. */
export const ParsedMimeHeader = Schema.Struct({
  name: Schema.NonEmptyString,
  value: Schema.String,
});
export interface ParsedMimeHeader extends Schema.Schema.Type<
  typeof ParsedMimeHeader
> {}

/** Parsed attachment bytes before Garden assigns an object-storage key. */
export const ParsedMimeAttachment = Schema.Struct({
  fileName: NonEmptyString,
  contentType: NonEmptyString,
  content: Schema.Uint8Array,
  sizeBytes: Schema.Natural,
  disposition: AttachmentDisposition,
  contentId: Schema.NullOr(NonEmptyString),
  position: Schema.Natural,
});
export interface ParsedMimeAttachment extends Schema.Schema.Type<
  typeof ParsedMimeAttachment
> {}

/**
 * Garden's normalized MIME result. HTML remains untrusted email content and
 * must be sanitized by the rendering boundary, not changed during ingestion.
 */
export const ParsedMimeMessage = Schema.Struct({
  headers: Schema.Array(ParsedMimeHeader),
  internetMessageId: Schema.NullOr(InternetMessageId),
  inReplyToMessageId: Schema.NullOr(InternetMessageId),
  referenceMessageIds: Schema.Array(InternetMessageId),
  sender: ParsedMimeAddress,
  replyTo: Schema.Array(ParsedMimeAddress),
  recipients: Schema.Array(ParsedMimeRecipient),
  subject: Schema.String,
  textBody: Schema.NullOr(Schema.String),
  htmlBody: Schema.NullOr(Schema.String),
  attachments: Schema.Array(ParsedMimeAttachment),
});
export interface ParsedMimeMessage extends Schema.Schema.Type<
  typeof ParsedMimeMessage
> {}

/** PostalMime rejected MIME syntax or failed while decoding its structure. */
export class MailMimeParseError extends Schema.TaggedErrorClass<MailMimeParseError>()(
  "MailMimeParseError",
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/** MIME parsed, but its normalized content violates Garden's mail contract. */
export class MailMimeValidationError extends Schema.TaggedErrorClass<MailMimeValidationError>()(
  "MailMimeValidationError",
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/** Converts absent or whitespace-only display names into the canonical null. */
const normalizeDisplayName = (name: string): string | null => {
  const normalized = Str.trim(name);
  return Str.isEmpty(normalized) ? null : normalized;
};

/** Canonicalizes routing addresses for mailbox matching and deduplication. */
const normalizeAddress = (address: string): string =>
  Str.toLowerCase(Str.trim(address));

/** Flattens RFC address groups without discarding individual display names. */
const postalMailboxes = (
  addresses: ReadonlyArray<PostalAddress> | undefined,
): Array<PostalMailbox> =>
  Arr.flatMap(addresses ?? [], (address) =>
    address.group === undefined ? [address] : address.group,
  );

/** Converts PostalMime addresses into an unknown value decoded once at ingress. */
const normalizedAddresses = (
  addresses: ReadonlyArray<PostalAddress> | undefined,
): ReadonlyArray<{
  readonly displayName: string | null;
  readonly address: string;
}> =>
  Arr.map(postalMailboxes(addresses), (mailbox) => ({
    displayName: normalizeDisplayName(mailbox.name),
    address: normalizeAddress(mailbox.address),
  }));

/** Removes RFC angle brackets while preserving the complete message-id token. */
const normalizeMessageIdToken = (value: string): string =>
  Str.trim(value).replace(/^<+|>+$/g, "");

/** Extracts ordered, unique RFC message-id tokens from a header value. */
const messageIds = (value: string | undefined): ReadonlyArray<string> => {
  if (value === undefined) return [];

  const bracketed = Arr.filterMap(
    Array.from(value.matchAll(/<([^<>]+)>/g)),
    (match) => {
      const token = match[1];
      if (token === undefined) return Result.failVoid;
      const normalized = normalizeMessageIdToken(token);
      return Str.isEmpty(normalized)
        ? Result.failVoid
        : Result.succeed(normalized);
    },
  );
  if (bracketed.length > 0) return Arr.dedupe(bracketed);

  return Arr.dedupe(
    Arr.filter(
      Arr.map(Str.split(value, /\s+/), normalizeMessageIdToken),
      (token) => !Str.isEmpty(token),
    ),
  );
};

/** Returns the first RFC message-id, or null when the header is absent. */
const firstMessageId = (value: string | undefined): string | null =>
  messageIds(value)[0] ?? null;

/**
 * Produces a stable, path-safe attachment label while retaining the sender's
 * filename wherever it is usable.
 */
const attachmentFileName = (
  fileName: string | null,
  position: number,
): string => {
  const normalized = Str.trim(fileName ?? "").replace(/[\\/\p{Cc}]/gu, "_");
  return Str.isEmpty(normalized) ? `attachment-${position + 1}` : normalized;
};

/** Normalizes a content-id for inline rendering without its transport brackets. */
const attachmentContentId = (contentId: string | undefined): string | null => {
  if (contentId === undefined) return null;
  const normalized = normalizeMessageIdToken(contentId);
  return Str.isEmpty(normalized) ? null : normalized;
};

/**
 * Converts every PostalMime attachment representation to owned bytes. The
 * parser is requested to return ArrayBuffers; string handling remains explicit
 * for the library's documented alternate encodings.
 */
const attachmentBytes = Effect.fn("MailMime.attachmentBytes")(function* (
  attachment: PostalAttachment,
) {
  if (typeof attachment.content !== "string") {
    return new Uint8Array(attachment.content);
  }

  if (attachment.encoding !== "base64") {
    return new TextEncoder().encode(attachment.content);
  }

  return yield* Effect.fromResult(
    Encoding.decodeBase64(attachment.content),
  ).pipe(
    Effect.mapError(
      (cause) =>
        new MailMimeValidationError({
          operation: "decodeAttachment",
          message: "A MIME attachment contains invalid base64 content.",
          cause,
        }),
    ),
  );
});

/** Decodes all attachments while retaining deterministic MIME order. */
const normalizedAttachments = Effect.fn("MailMime.normalizeAttachments")(
  function* (attachments: ReadonlyArray<PostalAttachment>) {
    return yield* Effect.forEach(attachments, (attachment, position) =>
      attachmentBytes(attachment).pipe(
        Effect.map((content) => ({
          fileName: attachmentFileName(attachment.filename, position),
          contentType:
            Str.toLowerCase(Str.trim(attachment.mimeType)) ||
            "application/octet-stream",
          content,
          sizeBytes: content.byteLength,
          disposition:
            attachment.disposition === "inline" || attachment.related === true
              ? "inline"
              : "attachment",
          contentId: attachmentContentId(attachment.contentId),
          position,
        })),
      ),
    );
  },
);

/**
 * Builds positional recipients exclusively from visible MIME headers. SMTP
 * envelope targets are private routing metadata resolved by the ingest service.
 */
const normalizedRecipients = (
  parsed: PostalEmail,
): ReadonlyArray<{
  readonly kind: "to" | "cc" | "bcc";
  readonly position: number;
  readonly displayName: string | null;
  readonly address: string;
}> => {
  const withKind = (
    kind: "to" | "cc" | "bcc",
    addresses: ReadonlyArray<PostalAddress> | undefined,
  ) =>
    Arr.map(normalizedAddresses(addresses), (address, position) => ({
      kind,
      position,
      ...address,
    }));

  return [
    ...withKind("to", parsed.to),
    ...withKind("cc", parsed.cc),
    ...withKind("bcc", parsed.bcc),
  ];
};

/** Selects the RFC From mailbox, then Sender, then SMTP envelope sender. */
const normalizedSender = (
  parsed: PostalEmail,
  envelopeFrom: string,
): { readonly displayName: string | null; readonly address: string } => {
  const from = normalizedAddresses(
    parsed.from === undefined ? undefined : [parsed.from],
  )[0];
  if (from !== undefined) return from;

  const sender = normalizedAddresses(
    parsed.sender === undefined ? undefined : [parsed.sender],
  )[0];
  if (sender !== undefined) return sender;

  return {
    displayName: null,
    address: normalizeAddress(envelopeFrom),
  };
};

/** Decodes a normalized candidate so malformed addresses never enter Garden. */
const decodeParsedMimeMessage = (
  value: unknown,
): Effect.Effect<ParsedMimeMessage, MailMimeValidationError> =>
  Schema.decodeUnknownEffect(ParsedMimeMessage)(value).pipe(
    Effect.mapError(
      (cause) =>
        new MailMimeValidationError({
          operation: "validate",
          message: "Parsed MIME does not satisfy Garden mail content rules.",
          cause,
        }),
    ),
  );

/**
 * Parses the one-time buffered inbound value into Garden's canonical content.
 * It verifies byte accounting and performs no retries because parsing is local.
 */
export const parseNormalizedMime = Effect.fn("MailMime.parseNormalized")(
  function* (inbound: NormalizedInboundMail) {
    if (
      inbound.raw.byteLength === 0 ||
      inbound.raw.byteLength !== inbound.rawSize
    ) {
      return yield* new MailMimeValidationError({
        operation: "validateRawSize",
        message:
          inbound.raw.byteLength === 0
            ? "Inbound MIME content is empty."
            : "Inbound MIME byte length does not match its declared size.",
      });
    }

    const parsed = yield* Effect.tryPromise({
      try: () =>
        PostalMime.parse(inbound.raw, {
          attachmentEncoding: "arraybuffer",
        }),
      catch: (cause) =>
        new MailMimeParseError({
          operation: "parse",
          message: "Inbound MIME could not be parsed.",
          cause,
        }),
    });
    const attachments = yield* normalizedAttachments(parsed.attachments);

    return yield* decodeParsedMimeMessage({
      headers: Arr.map(parsed.headers, (header) => ({
        name: Str.trim(header.originalKey || header.key),
        value: header.value,
      })),
      internetMessageId: firstMessageId(parsed.messageId),
      inReplyToMessageId: firstMessageId(parsed.inReplyTo),
      referenceMessageIds: messageIds(parsed.references),
      sender: normalizedSender(parsed, inbound.envelopeFrom),
      replyTo: normalizedAddresses(parsed.replyTo),
      recipients: normalizedRecipients(parsed),
      subject: parsed.subject ?? "",
      textBody: parsed.text ?? null,
      htmlBody: parsed.html ?? null,
      attachments,
    });
  },
);
