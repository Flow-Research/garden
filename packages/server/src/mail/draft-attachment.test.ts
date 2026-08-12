import { expect } from 'vitest'
import { it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import type { GardenDatabase } from '@garden/db'
import { MailboxId, WorkspaceId } from '@garden/core/mail'
import {
  DraftAttachmentValidationError,
  MAX_OUTBOUND_ATTACHMENT_BYTES,
  authorizeDraftAttachmentUpload,
  storeDraftAttachment,
} from './draft-attachment.ts'
import { testMailObjectStoreLayer } from './object-store.ts'

const input = {
  workspaceId: WorkspaceId.make('10000000-0000-4000-8000-000000000001'),
  mailboxId: MailboxId.make('10000000-0000-4000-8000-000000000002'),
  fileName: 'investor.pdf',
  contentType: 'application/pdf',
}

it.effect('rejects an oversized upload before storage or persistence', () =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(
      storeDraftAttachment({} as GardenDatabase, {
        ...input,
        content: new Uint8Array(MAX_OUTBOUND_ATTACHMENT_BYTES + 1),
      }),
    )
    expect(failure).toBeInstanceOf(DraftAttachmentValidationError)
  }).pipe(Effect.provide(testMailObjectStoreLayer)),
)

it.effect('persists immutable bytes and returns only public metadata', () => {
  const inserted: Array<Record<string, unknown>> = []
  const db = {
    insert: () => ({
      values: (value: Record<string, unknown>) => {
        inserted.push(value)
        return {
          returning: async () => [{ id: value.id }],
        }
      },
    }),
  } as unknown as GardenDatabase

  return Effect.gen(function* () {
    const descriptor = yield* storeDraftAttachment(db, {
      ...input,
      fileName: '../investor.pdf',
      content: Uint8Array.from([1, 2, 3]),
    })
    expect(descriptor).toMatchObject({
      fileName: '.._investor.pdf',
      contentType: 'application/pdf',
      sizeBytes: 3,
    })
    expect(descriptor).not.toHaveProperty('storageKey')
    expect(inserted[0]).toMatchObject({
      fileName: '.._investor.pdf',
      sizeBytes: 3,
    })
  }).pipe(Effect.provide(Layer.fresh(testMailObjectStoreLayer)))
})

it.effect('denies viewer and read-only mailbox uploads', () =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(
      authorizeDraftAttachmentUpload(
        [
          {
            id: input.mailboxId,
            accessLevel: 'viewer',
            sendCapability: 'gmail_transport',
          },
        ],
        input.mailboxId,
      ),
    )
    expect(failure).toBeInstanceOf(DraftAttachmentValidationError)
  }),
)
