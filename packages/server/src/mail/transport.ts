import { Context, Effect, Layer, Option, Ref, Schema } from "effect";
import type { MailSendReceipt, OutboundMail } from "./model.ts";

/** Expected provider failure, including the native code needed for policy decisions. */
export class MailTransportSendError extends Schema.TaggedErrorClass<MailTransportSendError>()(
  "MailTransportSendError",
  {
    provider: Schema.NonEmptyString,
    operation: Schema.String,
    message: Schema.String,
    code: Schema.optionalKey(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/** Failure while consuming a provider's one-shot inbound MIME stream. */
export class MailInboundReadError extends Schema.TaggedErrorClass<MailInboundReadError>()(
  "MailInboundReadError",
  {
    provider: Schema.NonEmptyString,
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export interface MailTransportService {
  readonly send: (
    mail: OutboundMail,
  ) => Effect.Effect<MailSendReceipt, MailTransportSendError>;
}

/** Garden Mail's sole outbound infrastructure authority. */
export class MailTransport extends Context.Service<
  MailTransport,
  MailTransportService
>()("@garden/server/MailTransport") {}

export interface TestMailTransportService extends MailTransportService {
  readonly sentMessages: () => Effect.Effect<ReadonlyArray<OutboundMail>>;
  readonly failNextSend: (error: MailTransportSendError) => Effect.Effect<void>;
}

/** Test control surface kept separate so production workflows depend on MailTransport only. */
export class TestMailTransport extends Context.Service<
  TestMailTransport,
  TestMailTransportService
>()("@garden/server/MailTransport/Test") {}

/**
 * Creates an isolated in-memory transport for Effect workflow tests. It records
 * authorized requests exactly as received and can deterministically fail once.
 */
export const testMailTransportLayer = Layer.effectContext(
  Effect.gen(function* () {
    const sent = yield* Ref.make<ReadonlyArray<OutboundMail>>([]);
    const nextFailure = yield* Ref.make<Option.Option<MailTransportSendError>>(
      Option.none(),
    );

    const service = TestMailTransport.of({
      send: Effect.fn("MailTransport.Test.send")(function* (
        mail: OutboundMail,
      ) {
        const failure = yield* Ref.getAndSet(nextFailure, Option.none());
        if (Option.isSome(failure)) return yield* failure.value;

        yield* Ref.update(sent, (messages) => [...messages, mail]);
        return {
          provider: "test",
          providerMessageId: `test-${yield* Ref.get(sent).pipe(
            Effect.map((messages) => messages.length),
          )}`,
        };
      }),
      sentMessages: Effect.fn("MailTransport.Test.sentMessages")(function* () {
        return yield* Ref.get(sent);
      }),
      failNextSend: Effect.fn("MailTransport.Test.failNextSend")(function* (
        error: MailTransportSendError,
      ) {
        yield* Ref.set(nextFailure, Option.some(error));
      }),
    });

    return Context.empty().pipe(
      Context.add(MailTransport, service),
      Context.add(TestMailTransport, service),
    );
  }),
);
