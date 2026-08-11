import {
  ingestNormalizedMail,
  makeMailRepositoryLayer,
  makeR2MailObjectStoreLayer,
  normalizeCloudflareInbound,
} from '@garden/server/mail'
import { Effect, Layer, Schema } from 'effect'
import type { AppEnv } from './env'
import { createRequestDbProvider } from './db'
import { dispatchInboundMailAgents } from './mail-agent-workflow'

/** Request-scoped Hyperdrive setup failed before Garden Mail could run. */
export class MailInboundDatabaseError extends Schema.TaggedErrorClass<MailInboundDatabaseError>()(
  'MailInboundDatabaseError',
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/** Marks malformed or unroutable messages as permanent SMTP rejections. */
const rejectInboundMessage = (
  message: ForwardableEmailMessage,
  reason: string,
): Effect.Effect<void> => Effect.sync(() => message.setReject(reason))

/**
 * Runs Cloudflare's single-use email event through Garden's provider-neutral
 * Effect application and always closes its request-scoped Hyperdrive client.
 * Cloudflare Email Service documents a 25 MiB inbound limit, so buffering the
 * raw MIME stream in the adapter remains bounded. Invalid MIME and unknown
 * local routes are permanent SMTP failures; storage and database failures stay
 * in the Effect error channel so Cloudflare records a failed invocation rather
 * than bouncing mail during a transient outage.
 *
 * References: Cloudflare Email Service Workers API and platform limits; local
 * `packages/server/src/mail/{cloudflare,ingress}.ts`.
 */
export const processCloudflareInboundMail = Effect.fn(
  'GardenMail.processCloudflareInboundMail',
)(function* (message: ForwardableEmailMessage, env: AppEnv) {
  const dbProvider = yield* Effect.sync(() => createRequestDbProvider(env))

  return yield* Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => dbProvider.db(),
      catch: (cause) =>
        new MailInboundDatabaseError({
          operation: 'connect',
          message: 'Garden Mail could not connect through Hyperdrive.',
          cause,
        }),
    }),
    (db) => {
      const dependencies = Layer.merge(
        makeMailRepositoryLayer(db),
        makeR2MailObjectStoreLayer(env.FILES),
      )

      return normalizeCloudflareInbound(message).pipe(
        Effect.flatMap(ingestNormalizedMail),
        Effect.flatMap((ingested) =>
          dispatchInboundMailAgents(db, env.MAIL_AGENT_WORKFLOW, {
            conversationIds: ingested.conversationIds,
            eventId: ingested.messageId,
          }).pipe(Effect.asVoid),
        ),
        Effect.provide(dependencies),
        Effect.catchTag('MailRepositoryNotFoundError', () =>
          rejectInboundMessage(message, 'Unknown recipient'),
        ),
        Effect.catchTag('MailMimeParseError', () =>
          rejectInboundMessage(message, 'Invalid message content'),
        ),
        Effect.catchTag('MailMimeValidationError', () =>
          rejectInboundMessage(message, 'Invalid message content'),
        ),
        Effect.asVoid,
      )
    },
    () => Effect.promise(() => dbProvider.close()),
  )
})
