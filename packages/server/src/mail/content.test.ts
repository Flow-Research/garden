import { StorageKey } from "@garden/core/mail";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { MailMimeValidationError, parseNormalizedMime } from "./mime.ts";
import type { NormalizedInboundMail } from "./model.ts";
import {
  MailObjectNotFoundError,
  MailObjectStore,
  TestMailObjectStore,
  testMailObjectStoreLayer,
} from "./object-store.ts";

const textEncoder = new TextEncoder();

/** Creates a buffered inbound value exactly as the Cloudflare adapter emits it. */
const normalizedInbound = (
  rawMime: string,
  envelope: { readonly from: string; readonly to: string } = {
    from: "bounce@example.com",
    to: "hidden@garden.example",
  },
): NormalizedInboundMail => {
  const raw = textEncoder.encode(rawMime);
  return {
    envelopeFrom: envelope.from,
    envelopeTo: envelope.to,
    headers: [],
    raw,
    rawSize: raw.byteLength,
  };
};

/** Representative multipart message exercises threading, bodies, and inline bytes. */
const multipartMime = [
  "From: Alice Investor <Alice@Example.com>",
  "To: Research <research@garden.example>",
  "Cc: Partner <partner@example.com>",
  "Reply-To: Alice Replies <reply@example.com>",
  "Subject: Quarterly update",
  "Message-ID: <message-3@example.com>",
  "In-Reply-To: <message-2@example.com>",
  "References: <message-1@example.com> <message-2@example.com> <message-1@example.com>",
  "MIME-Version: 1.0",
  'Content-Type: multipart/related; boundary="outer"',
  "",
  "--outer",
  'Content-Type: multipart/alternative; boundary="inner"',
  "",
  "--inner",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Plain update.",
  "--inner",
  "Content-Type: text/html; charset=utf-8",
  "",
  "<p>HTML update.</p>",
  "--inner--",
  "--outer",
  "Content-Type: image/png",
  'Content-Disposition: inline; filename="../chart.png"',
  "Content-ID: <chart@example.com>",
  "Content-Transfer-Encoding: base64",
  "",
  "AQID",
  "--outer--",
  "",
].join("\r\n");

describe("MailObjectStore", () => {
  it.effect(
    "stores owned byte copies and exposes deterministic test inspection",
    () =>
      Effect.gen(function* () {
        const store = yield* MailObjectStore;
        const testStore = yield* TestMailObjectStore;
        const key = StorageKey.make("mail/raw/message-1.eml");
        const content = new Uint8Array([1, 2, 3]);

        const metadata = yield* store.put({
          key,
          content,
          contentType: "message/rfc822",
        });
        content[0] = 9;

        const firstRead = yield* store.get(key);
        firstRead.content[1] = 9;
        const secondRead = yield* store.get(key);
        const objects = yield* testStore.objects();

        expect(metadata).toEqual({
          key,
          contentType: "message/rfc822",
          sizeBytes: 3,
          etag: null,
        });
        expect(Array.from(secondRead.content)).toEqual([1, 2, 3]);
        expect(objects.map((object) => object.key)).toEqual([key]);
        expect(Array.from(objects[0]?.content ?? [])).toEqual([1, 2, 3]);
      }).pipe(Effect.provide(testMailObjectStoreLayer)),
  );

  it.effect("reports missing content through the typed channel", () =>
    Effect.gen(function* () {
      const store = yield* MailObjectStore;
      const key = StorageKey.make("mail/attachments/missing");

      const error = yield* store.get(key).pipe(Effect.flip);

      expect(error).toBeInstanceOf(MailObjectNotFoundError);
      expect(error).toMatchObject({
        key,
        operation: "get",
      });
    }).pipe(Effect.provide(testMailObjectStoreLayer)),
  );
});

describe("MailMime", () => {
  it.effect("normalizes multipart MIME into Garden mail content", () =>
    Effect.gen(function* () {
      const parsed = yield* parseNormalizedMime(
        normalizedInbound(multipartMime),
      );

      expect(parsed).toMatchObject({
        internetMessageId: "message-3@example.com",
        inReplyToMessageId: "message-2@example.com",
        referenceMessageIds: ["message-1@example.com", "message-2@example.com"],
        sender: {
          displayName: "Alice Investor",
          address: "alice@example.com",
        },
        replyTo: [
          {
            displayName: "Alice Replies",
            address: "reply@example.com",
          },
        ],
        subject: "Quarterly update",
        textBody: "Plain update.\n",
        htmlBody: "<p>HTML update.</p>\n",
      });
      expect(parsed.recipients).toEqual([
        {
          kind: "to",
          position: 0,
          displayName: "Research",
          address: "research@garden.example",
        },
        {
          kind: "cc",
          position: 0,
          displayName: "Partner",
          address: "partner@example.com",
        },
      ]);
      expect(parsed.attachments).toHaveLength(1);
      expect(parsed.attachments[0]).toMatchObject({
        fileName: ".._chart.png",
        contentType: "image/png",
        sizeBytes: 3,
        disposition: "inline",
        contentId: "chart@example.com",
        position: 0,
      });
      expect(Array.from(parsed.attachments[0]?.content ?? [])).toEqual([
        1, 2, 3,
      ]);
      expect(
        parsed.headers.some(
          (header) =>
            header.name === "Message-ID" &&
            header.value === "<message-3@example.com>",
        ),
      ).toBe(true);
    }),
  );

  it.effect("rejects mismatched raw byte accounting before parsing", () =>
    Effect.gen(function* () {
      const inbound = normalizedInbound(multipartMime);
      const error = yield* parseNormalizedMime({
        ...inbound,
        rawSize: inbound.rawSize + 1,
      }).pipe(Effect.flip);

      expect(error).toBeInstanceOf(MailMimeValidationError);
      expect(error).toMatchObject({ operation: "validateRawSize" });
    }),
  );

  it.effect("rejects mail without a usable sender", () =>
    Effect.gen(function* () {
      const rawMime = [
        "To: receiver@example.com",
        "Subject: Missing sender",
        "",
        "Body",
      ].join("\r\n");
      const error = yield* parseNormalizedMime(
        normalizedInbound(rawMime, {
          from: "<>",
          to: "receiver@example.com",
        }),
      ).pipe(Effect.flip);

      expect(error).toBeInstanceOf(MailMimeValidationError);
      expect(error).toMatchObject({ operation: "validate" });
    }),
  );
});
