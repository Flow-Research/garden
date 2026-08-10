/// <reference types="@cloudflare/workers-types" />

import { Context, Effect, Layer } from "effect";
import type {
  MailAttachment,
  MailTransportAddress,
  NormalizedInboundMail,
  OutboundMail,
} from "./model.ts";
import {
  MailInboundReadError,
  MailTransport,
  MailTransportSendError,
} from "./transport.ts";

export const CLOUDFLARE_MAIL_PROVIDER = "cloudflare-email-service";

export interface CloudflareMailBindingService {
  readonly binding: SendEmail;
}

/** Host-supplied Cloudflare authority kept explicit in the Effect layer graph. */
export class CloudflareMailBinding extends Context.Service<
  CloudflareMailBinding,
  CloudflareMailBindingService
>()("@garden/server/CloudflareMailBinding") {}

const toCloudflareAddress = (
  address: MailTransportAddress,
): string | EmailAddress =>
  address.name === undefined
    ? address.address
    : { email: address.address, name: address.name };

const toCloudflareAttachment = (
  attachment: MailAttachment,
): EmailAttachment => {
  if (attachment._tag === "Attachment") {
    return {
      content: attachment.content,
      disposition: "attachment",
      filename: attachment.filename,
      type: attachment.mediaType,
    };
  }

  return {
    content: attachment.content,
    contentId: attachment.contentId,
    disposition: "inline",
    filename: attachment.filename,
    type: attachment.mediaType,
  };
};

/** Maps Garden's canonical request into Cloudflare's native SendEmail builder. */
const toCloudflareMessage = (mail: OutboundMail): EmailMessageBuilder => ({
  from: toCloudflareAddress(mail.from),
  to: mail.to.map(toCloudflareAddress),
  cc: mail.cc.map(toCloudflareAddress),
  bcc: mail.bcc.map(toCloudflareAddress),
  ...(mail.replyTo === undefined
    ? {}
    : { replyTo: toCloudflareAddress(mail.replyTo) }),
  subject: mail.subject,
  text: mail.text,
  ...(mail.html === undefined ? {} : { html: mail.html }),
  headers: { ...mail.headers },
  attachments: mail.attachments.map(toCloudflareAttachment),
});

/** Safely extracts Cloudflare's documented E_* code from an unknown rejection. */
const cloudflareErrorCode = (cause: unknown): string | undefined => {
  if (
    typeof cause !== "object" ||
    cause === null ||
    !("code" in cause) ||
    typeof cause.code !== "string"
  ) {
    return undefined;
  }
  return cause.code;
};

/** Converts the binding's unknown Promise rejection into Garden's typed channel. */
const toCloudflareSendError = (cause: unknown): MailTransportSendError => {
  const code = cloudflareErrorCode(cause);
  return new MailTransportSendError({
    provider: CLOUDFLARE_MAIL_PROVIDER,
    operation: "send",
    message:
      cause instanceof Error
        ? cause.message
        : "Cloudflare Email Service rejected the message.",
    ...(code === undefined ? {} : { code }),
    cause,
  });
};

/**
 * Adapts the native binding at the sole Promise boundary. No retries occur here:
 * Garden's durable send workflow must decide if and when a send is safe to repeat.
 */
export const cloudflareMailTransportLayer: Layer.Layer<
  MailTransport,
  never,
  CloudflareMailBinding
> = Layer.effect(
  MailTransport,
  Effect.gen(function* () {
    const config = yield* CloudflareMailBinding;
    return MailTransport.of({
      send: Effect.fn("CloudflareMailTransport.send")((mail: OutboundMail) =>
        Effect.tryPromise({
          try: () => config.binding.send(toCloudflareMessage(mail)),
          catch: toCloudflareSendError,
        }).pipe(
          Effect.map((result) => ({
            provider: CLOUDFLARE_MAIL_PROVIDER,
            providerMessageId: result.messageId,
          })),
        ),
      ),
    });
  }),
);

/** Builds the host boundary layer from the generated native Worker binding. */
export const makeCloudflareMailTransportLayer = (
  binding: SendEmail,
): Layer.Layer<MailTransport> =>
  cloudflareMailTransportLayer.pipe(
    Layer.provide(
      Layer.succeed(CloudflareMailBinding)({
        binding,
      }),
    ),
  );

/**
 * Consumes Cloudflare's single-use raw stream exactly once and snapshots every
 * exposed header. Raw MIME bytes remain authoritative for later parsing/storage.
 */
export const normalizeCloudflareInbound = Effect.fn(
  "CloudflareMailTransport.normalizeInbound",
)(function* (
  message: ForwardableEmailMessage,
): Effect.fn.Return<NormalizedInboundMail, MailInboundReadError> {
  const buffer = yield* Effect.tryPromise({
    try: () => new Response(message.raw).arrayBuffer(),
    catch: (cause) =>
      new MailInboundReadError({
        provider: CLOUDFLARE_MAIL_PROVIDER,
        operation: "normalizeInbound",
        message: "Cloudflare inbound MIME stream could not be buffered.",
        cause,
      }),
  });

  return {
    envelopeFrom: message.from,
    envelopeTo: message.to,
    headers: Array.from(message.headers.entries(), ([name, value]) => ({
      name,
      value,
    })),
    raw: new Uint8Array(buffer),
    rawSize: message.rawSize,
  };
});
