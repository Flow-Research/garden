/// <reference types="@cloudflare/workers-types" />

import { StorageKey } from "@garden/core/mail";
import { Context, Effect, Layer, Ref, Schema } from "effect";

/** Binary mail content and its media type at the object-storage boundary. */
export const MailObject = Schema.Struct({
  key: StorageKey,
  content: Schema.Uint8Array,
  contentType: Schema.NonEmptyString,
});
export interface MailObject extends Schema.Schema.Type<typeof MailObject> {}

/** Provider-neutral metadata returned after an object is durably accepted. */
export const StoredMailObject = Schema.Struct({
  key: StorageKey,
  contentType: Schema.NonEmptyString,
  sizeBytes: Schema.Natural,
  etag: Schema.NullOr(Schema.String),
});
export interface StoredMailObject extends Schema.Schema.Type<
  typeof StoredMailObject
> {}

/** Expected R2 or compatible-store failure while writing mail content. */
export class MailObjectWriteError extends Schema.TaggedErrorClass<MailObjectWriteError>()(
  "MailObjectWriteError",
  {
    key: StorageKey,
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/** Expected R2 or compatible-store failure while reading mail content. */
export class MailObjectReadError extends Schema.TaggedErrorClass<MailObjectReadError>()(
  "MailObjectReadError",
  {
    key: StorageKey,
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/** A referenced mail object no longer exists in the configured store. */
export class MailObjectNotFoundError extends Schema.TaggedErrorClass<MailObjectNotFoundError>()(
  "MailObjectNotFoundError",
  {
    key: StorageKey,
    operation: Schema.String,
    message: Schema.String,
  },
) {}

/** Expected R2 or compatible-store failure while deleting mail content. */
export class MailObjectDeleteError extends Schema.TaggedErrorClass<MailObjectDeleteError>()(
  "MailObjectDeleteError",
  {
    key: StorageKey,
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export interface MailObjectStoreService {
  readonly put: (
    object: MailObject,
  ) => Effect.Effect<StoredMailObject, MailObjectWriteError>;
  readonly get: (
    key: StorageKey,
  ) => Effect.Effect<MailObject, MailObjectNotFoundError | MailObjectReadError>;
  readonly delete: (
    key: StorageKey,
  ) => Effect.Effect<void, MailObjectDeleteError>;
}

/** Garden Mail's provider-neutral authority for raw MIME and attachments. */
export class MailObjectStore extends Context.Service<
  MailObjectStore,
  MailObjectStoreService
>()("@garden/server/MailObjectStore") {}

export interface TestMailObjectStoreService extends MailObjectStoreService {
  readonly objects: () => Effect.Effect<ReadonlyArray<MailObject>>;
}

/** Inspection surface available only to deterministic mail-content tests. */
export class TestMailObjectStore extends Context.Service<
  TestMailObjectStore,
  TestMailObjectStoreService
>()("@garden/server/MailObjectStore/Test") {}

/** Copies bytes so mutations outside a store cannot change persisted content. */
const copyBytes = (content: Uint8Array): Uint8Array => new Uint8Array(content);

/** Converts a successful R2 write into Garden's provider-neutral metadata. */
const storedR2Object = (
  object: MailObject,
  stored: R2Object,
): StoredMailObject => ({
  key: object.key,
  contentType: object.contentType,
  sizeBytes: stored.size,
  etag: stored.etag,
});

/**
 * Builds Garden's R2-backed mail object store. Promise interop stays inside
 * this adapter; callers receive only typed Effect failures.
 */
export const makeR2MailObjectStoreLayer = (
  bucket: R2Bucket,
): Layer.Layer<MailObjectStore> =>
  Layer.succeed(
    MailObjectStore,
    MailObjectStore.of({
      put: Effect.fn("R2MailObjectStore.put")((object: MailObject) =>
        Effect.sync(() => copyBytes(object.content)).pipe(
          Effect.flatMap((content) =>
            Effect.tryPromise({
              try: () =>
                bucket.put(object.key, content, {
                  httpMetadata: { contentType: object.contentType },
                }),
              catch: (cause) =>
                new MailObjectWriteError({
                  key: object.key,
                  operation: "put",
                  message: "Mail content could not be written to R2.",
                  cause,
                }),
            }),
          ),
          Effect.map((stored) => storedR2Object(object, stored)),
        ),
      ),
      get: Effect.fn("R2MailObjectStore.get")(function* (key: StorageKey) {
        const stored = yield* Effect.tryPromise({
          try: () => bucket.get(key),
          catch: (cause) =>
            new MailObjectReadError({
              key,
              operation: "get",
              message: "Mail content could not be read from R2.",
              cause,
            }),
        });

        if (stored === null) {
          return yield* new MailObjectNotFoundError({
            key,
            operation: "get",
            message: "Mail content does not exist in R2.",
          });
        }

        const content = yield* Effect.tryPromise({
          try: () => stored.bytes(),
          catch: (cause) =>
            new MailObjectReadError({
              key,
              operation: "readBody",
              message: "Mail content body could not be read from R2.",
              cause,
            }),
        });

        return {
          key,
          content: copyBytes(content),
          contentType:
            stored.httpMetadata?.contentType?.trim() ||
            "application/octet-stream",
        };
      }),
      delete: Effect.fn("R2MailObjectStore.delete")((key: StorageKey) =>
        Effect.tryPromise({
          try: () => bucket.delete(key),
          catch: (cause) =>
            new MailObjectDeleteError({
              key,
              operation: "delete",
              message: "Mail content could not be deleted from R2.",
              cause,
            }),
        }),
      ),
    }),
  );

/**
 * Provides a fresh in-memory store for each test layer acquisition. It follows
 * the production copy-on-write/read semantics so byte mutation bugs remain visible.
 */
export const testMailObjectStoreLayer = Layer.effectContext(
  Effect.gen(function* () {
    const stored = yield* Ref.make<ReadonlyMap<StorageKey, MailObject>>(
      new Map(),
    );

    const service = TestMailObjectStore.of({
      put: Effect.fn("MailObjectStore.Test.put")(function* (
        object: MailObject,
      ) {
        const persisted = {
          ...object,
          content: copyBytes(object.content),
        };
        yield* Ref.update(stored, (objects) => {
          const next = new Map(objects);
          next.set(object.key, persisted);
          return next;
        });
        return {
          key: object.key,
          contentType: object.contentType,
          sizeBytes: object.content.byteLength,
          etag: null,
        };
      }),
      get: Effect.fn("MailObjectStore.Test.get")(function* (key: StorageKey) {
        const object = (yield* Ref.get(stored)).get(key);
        if (object === undefined) {
          return yield* new MailObjectNotFoundError({
            key,
            operation: "get",
            message: "Mail content does not exist in the in-memory store.",
          });
        }
        return { ...object, content: copyBytes(object.content) };
      }),
      delete: Effect.fn("MailObjectStore.Test.delete")(function* (
        key: StorageKey,
      ) {
        yield* Ref.update(stored, (objects) => {
          const next = new Map(objects);
          next.delete(key);
          return next;
        });
      }),
      objects: Effect.fn("MailObjectStore.Test.objects")(function* () {
        const objects = yield* Ref.get(stored);
        return [...objects.values()]
          .sort((left, right) => left.key.localeCompare(right.key))
          .map((object) => ({
            ...object,
            content: copyBytes(object.content),
          }));
      }),
    });

    return Context.empty().pipe(
      Context.add(MailObjectStore, service),
      Context.add(TestMailObjectStore, service),
    );
  }),
);
