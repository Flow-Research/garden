/// <reference types="@cloudflare/workers-types" />

import {
  MailSyncAccountId,
  ProviderObjectId,
  UserId,
} from '@garden/core/mail'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Ref } from 'effect'
import {
  GmailOutboundGateway,
  gmailRawBase64Url,
  makeRoutedMailTransportLayer,
} from './gmail-transport.ts'
import type { OutboundMail } from './model.ts'
import { MailTransport } from './transport.ts'

const outbound: OutboundMail = {
  from: { address: 'person@gmail.com', name: 'Person' },
  to: [{ address: 'investor@example.com' }],
  cc: [],
  bcc: [],
  subject: 'Re: Investor update',
  text: 'Approved response.',
  html: '<p>Approved response.</p>',
  headers: {
    'Message-ID': '<draft-1@gmail.com>',
    'In-Reply-To': '<original@example.com>',
    References: '<older@example.com> <original@example.com>',
  },
  attachments: [],
}

/** Gmail route never invokes Cloudflare; the binding is a failing tripwire. */
const unusedCloudflareBinding: SendEmail = {
  send: () => Promise.reject(new Error('Cloudflare must not receive Gmail mail.')),
}

const decodeBase64Url = (value: string): string => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  const binary = atob(padded)
  return new TextDecoder().decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  )
}

describe('Gmail outbound transport', () => {
  it.effect('encodes RFC reply headers as Gmail base64url', () =>
    Effect.sync(() => {
      const raw = gmailRawBase64Url(outbound)
      expect(raw).not.toContain('+')
      expect(raw).not.toContain('/')
      expect(raw).not.toContain('=')

      const mime = decodeBase64Url(raw)
      expect(mime).toContain('Subject: Re: Investor update')
      expect(mime).toContain('In-Reply-To: <original@example.com>')
      expect(mime).toContain(
        'References: <older@example.com> <original@example.com>',
      )
    }),
  )

  it.effect('selects the connected account and preserves Gmail thread identity', () =>
    Effect.gen(function* () {
      const observed = yield* Ref.make<ReadonlyArray<unknown>>([])
      const gatewayLayer = Layer.succeed(
        GmailOutboundGateway,
        GmailOutboundGateway.of({
          send: (account, input) =>
            Ref.update(observed, (values) => [...values, { account, input }]).pipe(
              Effect.as({ id: 'gmail-message-1', threadId: 'gmail-thread-1' }),
            ),
        }),
      )
      const transportLayer = makeRoutedMailTransportLayer(
        unusedCloudflareBinding,
      ).pipe(Layer.provide(gatewayLayer))
      const receipt = yield* Effect.gen(function* () {
        const transport = yield* MailTransport
        return yield* transport.send({
          route: {
            _tag: 'Gmail',
            provider: 'gmail',
            syncAccountId: MailSyncAccountId.make(
              '40000000-0000-4000-8000-000000000001',
            ),
            userId: UserId.make('40000000-0000-4000-8000-000000000002'),
            executorIntegration: 'google_gmail',
            executorConnectionName: 'person@gmail.com',
            threadId: ProviderObjectId.make('gmail-thread-1'),
          },
          mail: outbound,
        })
      }).pipe(Effect.provide(transportLayer))

      expect(receipt).toEqual({
        provider: 'gmail',
        providerMessageId: 'gmail-message-1',
      })
      expect(yield* Ref.get(observed)).toMatchObject([
        {
          account: {
            executorIntegration: 'google_gmail',
            executorConnectionName: 'person@gmail.com',
          },
          input: { threadId: 'gmail-thread-1' },
        },
      ])
    }),
  )
})
