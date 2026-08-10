import {
  InternetMessageId,
  ProviderObjectId,
  WorkspaceId,
} from '@garden/core/mail'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  attachmentStorageKey,
  inboundProviderMessageId,
  mailThreadKey,
  normalizedMailSubject,
  rawMailStorageKey,
  sha256,
} from './content-addressing.ts'

const workspaceId = WorkspaceId.make('e0d06708-dc2d-4d8b-83d1-209ce463ea8c')

describe('Mail content addressing', () => {
  it.effect(
    'derives stable provider and object identities from exact bytes',
    () =>
      Effect.gen(function* () {
        const contentHash = yield* sha256(new TextEncoder().encode('hello'))

        expect(contentHash).toBe(
          '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
        )
        expect(inboundProviderMessageId(contentHash)).toBe(contentHash)
        expect(rawMailStorageKey(workspaceId, contentHash)).toBe(
          `mail/${workspaceId}/raw/${contentHash}.eml`,
        )
        expect(
          attachmentStorageKey(workspaceId, contentHash, contentHash, 0),
        ).toBe(
          `mail/${workspaceId}/attachments/${contentHash}/0-${contentHash}`,
        )
      }),
  )

  it('keeps new messages and replies on the same RFC root', () => {
    const root = InternetMessageId.make('root@example.com')
    const reply = InternetMessageId.make('reply@example.com')
    const providerMessageId = ProviderObjectId.make('content-hash')

    expect(
      mailThreadKey({
        internetMessageId: root,
        inReplyToMessageId: null,
        referenceMessageIds: [],
        providerMessageId,
      }),
    ).toBe(root)
    expect(
      mailThreadKey({
        internetMessageId: reply,
        inReplyToMessageId: root,
        referenceMessageIds: [root],
        providerMessageId,
      }),
    ).toBe(root)
  })

  it('normalizes repeated reply prefixes without erasing the subject', () => {
    expect(normalizedMailSubject(' Re: FWD:  Portfolio   update ')).toBe(
      'portfolio update',
    )
    expect(normalizedMailSubject('')).toBe('')
  })
})
