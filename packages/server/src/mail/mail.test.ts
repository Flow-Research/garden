/// <reference types="@cloudflare/workers-types" />

import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  makeCloudflareMailTransportLayer,
  normalizeCloudflareInbound,
} from './cloudflare.ts'
import type { OutboundMail } from './model.ts'
import {
  MailTransport,
  MailTransportSendError,
  TestMailTransport,
  testMailTransportLayer,
} from './transport.ts'

/** Supplies one representative request shared across transport contract tests. */
const outboundMail = (): OutboundMail => ({
  from: { address: 'agent@garden.example', name: 'Garden Agent' },
  to: [{ address: 'investor@example.com' }],
  cc: [{ address: 'partner@example.com', name: 'Partner' }],
  bcc: [],
  replyTo: { address: 'team@garden.example' },
  subject: 'Garden update',
  text: 'The report is ready.',
  html: '<p>The report is ready.</p>',
  headers: { 'In-Reply-To': '<original@example.com>' },
  attachments: [
    {
      _tag: 'Inline',
      filename: 'chart.png',
      mediaType: 'image/png',
      content: new Uint8Array([1, 2, 3]),
      contentId: 'chart',
    },
  ],
})

class TestCloudflareError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/** Native binding fake verifies adapter mapping without replacing Garden's test layer. */
class RecordingSendEmail implements SendEmail {
  readonly messages: EmailMessageBuilder[] = []
  nextFailure: TestCloudflareError | undefined

  send(message: EmailMessage): Promise<EmailSendResult>
  send(builder: EmailMessageBuilder): Promise<EmailSendResult>
  send(input: EmailMessage | EmailMessageBuilder): Promise<EmailSendResult> {
    if (!('subject' in input)) {
      return Promise.reject(new Error('Expected composed email fields.'))
    }
    const failure = this.nextFailure
    this.nextFailure = undefined
    if (failure !== undefined) return Promise.reject(failure)

    this.messages.push(input)
    return Promise.resolve({ messageId: 'cf-message-1' })
  }
}

/** Builds a native inbound-message double around an observable one-shot stream. */
const inboundMessage = (raw: ReadableStream<Uint8Array>) =>
  ({
    from: 'sender@example.com',
    to: 'research@garden.example',
    raw,
    rawSize: 5,
    headers: new Headers([
      ['Message-ID', '<message@example.com>'],
      ['Subject', 'Hello'],
    ]),
    setReject: () => undefined,
    forward: () => Promise.resolve({ messageId: 'forwarded' }),
    reply: () => Promise.resolve({ messageId: 'replied' }),
  }) satisfies ForwardableEmailMessage

describe('MailTransport', () => {
  it.effect('records authorized mail through the reusable test layer', () =>
    Effect.gen(function* () {
      const transport = yield* MailTransport
      const testTransport = yield* TestMailTransport
      const mail = outboundMail()

      const receipt = yield* transport.send(mail)
      const sent = yield* testTransport.sentMessages()

      expect(receipt).toEqual({
        provider: 'test',
        providerMessageId: 'test-1',
      })
      expect(sent).toEqual([mail])
    }).pipe(Effect.provide(testMailTransportLayer)),
  )

  it.effect('fails exactly the next fake send', () =>
    Effect.gen(function* () {
      const transport = yield* MailTransport
      const testTransport = yield* TestMailTransport
      const expected = new MailTransportSendError({
        provider: 'test',
        operation: 'send',
        message: 'planned failure',
        code: 'TEST_FAILURE',
      })

      yield* testTransport.failNextSend(expected)
      const error = yield* transport.send(outboundMail()).pipe(Effect.flip)
      expect(error).toBe(expected)

      const receipt = yield* transport.send(outboundMail())
      expect(receipt.providerMessageId).toBe('test-1')
    }).pipe(Effect.provide(testMailTransportLayer)),
  )
})

describe('CloudflareMailTransport', () => {
  it.effect('maps Garden mail to the native SendEmail binding', () => {
    const binding = new RecordingSendEmail()

    return Effect.gen(function* () {
      const transport = yield* MailTransport
      const receipt = yield* transport.send(outboundMail())

      expect(receipt).toEqual({
        provider: 'cloudflare-email-service',
        providerMessageId: 'cf-message-1',
      })
      expect(binding.messages).toEqual([
        {
          from: { email: 'agent@garden.example', name: 'Garden Agent' },
          to: ['investor@example.com'],
          cc: [{ email: 'partner@example.com', name: 'Partner' }],
          bcc: [],
          replyTo: 'team@garden.example',
          subject: 'Garden update',
          text: 'The report is ready.',
          html: '<p>The report is ready.</p>',
          headers: { 'In-Reply-To': '<original@example.com>' },
          attachments: [
            {
              content: new Uint8Array([1, 2, 3]),
              contentId: 'chart',
              disposition: 'inline',
              filename: 'chart.png',
              type: 'image/png',
            },
          ],
        },
      ])
    }).pipe(Effect.provide(makeCloudflareMailTransportLayer(binding)))
  })

  it.effect('preserves Cloudflare error codes as typed Effect failures', () => {
    const binding = new RecordingSendEmail()
    binding.nextFailure = new TestCloudflareError(
      'E_SENDER_NOT_VERIFIED',
      'sender domain is not onboarded',
    )

    return Effect.gen(function* () {
      const transport = yield* MailTransport
      const error = yield* transport.send(outboundMail()).pipe(Effect.flip)

      expect(error).toBeInstanceOf(MailTransportSendError)
      expect(error).toMatchObject({
        provider: 'cloudflare-email-service',
        operation: 'send',
        code: 'E_SENDER_NOT_VERIFIED',
        message: 'sender domain is not onboarded',
      })
    }).pipe(Effect.provide(makeCloudflareMailTransportLayer(binding)))
  })

  it.effect(
    'buffers the inbound stream once and preserves raw MIME and headers',
    () =>
      Effect.gen(function* () {
        let pulls = 0
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            pulls += 1
            controller.enqueue(new Uint8Array([1, 2]))
            controller.enqueue(new Uint8Array([3, 4, 5]))
            controller.close()
          },
        })

        const normalized = yield* normalizeCloudflareInbound(
          inboundMessage(stream),
        )

        expect(pulls).toBe(1)
        expect(normalized).toMatchObject({
          envelopeFrom: 'sender@example.com',
          envelopeTo: 'research@garden.example',
          rawSize: 5,
        })
        expect(Array.from(normalized.raw)).toEqual([1, 2, 3, 4, 5])
        expect(normalized.headers).toEqual([
          { name: 'message-id', value: '<message@example.com>' },
          { name: 'subject', value: 'Hello' },
        ])
      }),
  )

  it.effect('maps inbound stream failures without throwing', () =>
    Effect.gen(function* () {
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(new Error('stream failed'))
        },
      })

      const error = yield* normalizeCloudflareInbound(
        inboundMessage(stream),
      ).pipe(Effect.flip)

      expect(error).toBeInstanceOf(Error)
      expect(error).toMatchObject({
        _tag: 'MailInboundReadError',
        provider: 'cloudflare-email-service',
        operation: 'normalizeInbound',
      })
    }),
  )
})
