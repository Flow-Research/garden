import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Redacted } from 'effect'
import * as HttpClient from 'effect/unstable/http/HttpClient'
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse'
import * as UrlParams from 'effect/unstable/http/UrlParams'
import { GmailApiError, makeGmailClient } from './gmail-client.ts'

interface QueuedResponse {
  readonly status?: number
  readonly body: unknown
}

/** Records fully transformed Gmail requests and serves deterministic JSON. */
const recordingClient = (responses: ReadonlyArray<QueuedResponse>) => {
  const requests: HttpClientRequest.HttpClientRequest[] = []
  let index = 0
  const client = HttpClient.make((request) => {
    requests.push(request)
    const response = responses[index] ?? { status: 500, body: {} }
    index += 1
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify(response.body), {
          status: response.status ?? 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
  })
  return { client, requests }
}

describe('GmailClient', () => {
  it.effect(
    'calls the exact profile, list, raw, and history REST endpoints',
    () => {
      const fixture = recordingClient([
        {
          body: {
            emailAddress: 'person@example.com',
            messagesTotal: 8,
            threadsTotal: 5,
            historyId: '101',
          },
        },
        {
          body: {
            messages: [{ id: 'message-1', threadId: 'thread-1' }],
            nextPageToken: 'next-message-page',
            resultSizeEstimate: 8,
          },
        },
        {
          body: {
            id: 'message-1',
            threadId: 'thread-1',
            labelIds: ['INBOX', 'UNREAD'],
            historyId: '102',
            internalDate: '1786435200000',
            sizeEstimate: 1234,
            raw: 'RnJvbTogcGVyc29uQGV4YW1wbGUuY29t',
          },
        },
        {
          body: {
            history: [
              {
                id: '103',
                messagesAdded: [
                  { message: { id: 'message-2', threadId: 'thread-2' } },
                ],
                labelsAdded: [
                  {
                    message: { id: 'message-1', threadId: 'thread-1' },
                    labelIds: ['STARRED'],
                  },
                ],
              },
            ],
            nextPageToken: 'next-history-page',
            historyId: '103',
          },
        },
        {
          body: {
            id: 'sent-message-1',
            threadId: 'thread-1',
            labelIds: ['SENT'],
          },
        },
        {
          body: {
            id: 'message-1',
            threadId: 'thread-1',
            labelIds: ['INBOX', 'STARRED'],
          },
        },
        { body: { id: 'thread-1', historyId: '104' } },
      ])

      return Effect.gen(function* () {
        const client = yield* makeGmailClient(Redacted.make('access-token'))

        expect(yield* client.getProfile()).toMatchObject({
          emailAddress: 'person@example.com',
          historyId: '101',
        })
        expect(
          yield* client.listMessages({
            maxResults: 500,
            pageToken: 'message-page',
            query: 'in:anywhere',
            labelIds: ['INBOX', 'IMPORTANT'],
            includeSpamTrash: true,
          }),
        ).toMatchObject({ resultSizeEstimate: 8 })
        expect(yield* client.getRawMessage('message/1')).toMatchObject({
          id: 'message-1',
          internalDate: '1786435200000',
        })
        expect(
          yield* client.listHistory({
            startHistoryId: '101',
            maxResults: 500,
            pageToken: 'history-page',
            labelId: 'INBOX',
            historyTypes: ['messageAdded', 'labelAdded'],
          }),
        ).toMatchObject({ historyId: '103' })
        expect(
          yield* client.sendMessage({
            raw: 'RnJvbTogcGVyc29uQGV4YW1wbGUuY29t',
            threadId: 'thread-1',
          }),
        ).toMatchObject({ id: 'sent-message-1', threadId: 'thread-1' })
        expect(
          yield* client.modifyMessage({
            messageId: 'message/1',
            addLabelIds: ['STARRED'],
            removeLabelIds: ['UNREAD'],
          }),
        ).toMatchObject({ id: 'message-1', labelIds: ['INBOX', 'STARRED'] })
        expect(
          yield* client.modifyThread({
            threadId: 'thread/1',
            addLabelIds: [],
            removeLabelIds: ['INBOX'],
          }),
        ).toMatchObject({ id: 'thread-1', historyId: '104' })

        expect(
          fixture.requests.map((request) => [
            request.method,
            `${request.url}${request.urlParams.params.length === 0 ? '' : `?${UrlParams.toString(request.urlParams)}`}`,
          ]),
        ).toEqual([
          ['GET', 'https://gmail.googleapis.com/gmail/v1/users/me/profile'],
          [
            'GET',
            'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=500&pageToken=message-page&q=in%3Aanywhere&labelIds=INBOX&labelIds=IMPORTANT&includeSpamTrash=true',
          ],
          [
            'GET',
            'https://gmail.googleapis.com/gmail/v1/users/me/messages/message%2F1?format=raw',
          ],
          [
            'GET',
            'https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=101&maxResults=500&pageToken=history-page&labelId=INBOX&historyTypes=messageAdded&historyTypes=labelAdded',
          ],
          [
            'POST',
            'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
          ],
          [
            'POST',
            'https://gmail.googleapis.com/gmail/v1/users/me/messages/message%2F1/modify',
          ],
          [
            'POST',
            'https://gmail.googleapis.com/gmail/v1/users/me/threads/thread%2F1/modify',
          ],
        ])
        const recordedSendRequest = fixture.requests[4]
        if (recordedSendRequest === undefined) {
          return yield* Effect.die('Expected Gmail send request.')
        }
        const sendRequest = yield* HttpClientRequest.toWeb(recordedSendRequest)
        expect(yield* Effect.promise(() => sendRequest.json())).toEqual({
          raw: 'RnJvbTogcGVyc29uQGV4YW1wbGUuY29t',
          threadId: 'thread-1',
        })
        const recordedModifyRequest = fixture.requests[5]
        if (recordedModifyRequest === undefined) {
          return yield* Effect.die('Expected Gmail modify request.')
        }
        const modifyRequest = yield* HttpClientRequest.toWeb(
          recordedModifyRequest,
        )
        expect(yield* Effect.promise(() => modifyRequest.json())).toEqual({
          addLabelIds: ['STARRED'],
          removeLabelIds: ['UNREAD'],
        })
        const recordedThreadRequest = fixture.requests[6]
        if (recordedThreadRequest === undefined) {
          return yield* Effect.die('Expected Gmail thread modify request.')
        }
        const threadRequest = yield* HttpClientRequest.toWeb(
          recordedThreadRequest,
        )
        expect(yield* Effect.promise(() => threadRequest.json())).toEqual({
          addLabelIds: [],
          removeLabelIds: ['INBOX'],
        })
        expect(
          fixture.requests.every((request) =>
            request.headers.authorization?.startsWith('Bearer '),
          ),
        ).toBe(true)
      }).pipe(
        Effect.provide(Layer.succeed(HttpClient.HttpClient, fixture.client)),
      )
    },
  )

  it.effect(
    'classifies credential rejection without decoding provider details',
    () => {
      const fixture = recordingClient([
        {
          status: 401,
          body: { error: { message: 'private provider detail' } },
        },
      ])

      return Effect.gen(function* () {
        const client = yield* makeGmailClient(Redacted.make('access-token'))
        const error = yield* client.getProfile().pipe(Effect.flip)
        expect(error).toBeInstanceOf(GmailApiError)
        expect(error).toMatchObject({
          operation: 'getProfile',
          reason: 'unauthorized',
          statusCode: 401,
        })
        expect(error.message).not.toContain('private provider detail')
        expect(fixture.requests).toHaveLength(1)
      }).pipe(
        Effect.provide(Layer.succeed(HttpClient.HttpClient, fixture.client)),
      )
    },
  )

  it.effect('returns transient rejection to the durable caller', () => {
    const fixture = recordingClient([
      { status: 503, body: { error: { message: 'temporarily unavailable' } } },
      {
        body: {
          emailAddress: 'person@example.com',
          messagesTotal: 8,
          threadsTotal: 5,
          historyId: '101',
        },
      },
    ])

    return Effect.gen(function* () {
      const client = yield* makeGmailClient(Redacted.make('access-token'))
      const error = yield* client.getProfile().pipe(Effect.flip)

      expect(error).toMatchObject({
        operation: 'getProfile',
        reason: 'rejected',
        statusCode: 503,
      })
      expect(fixture.requests).toHaveLength(1)
    }).pipe(
      Effect.provide(Layer.succeed(HttpClient.HttpClient, fixture.client)),
    )
  })

  it.effect(
    'rejects malformed successful payloads at the provider boundary',
    () => {
      const fixture = recordingClient([{ body: { emailAddress: '' } }])

      return Effect.gen(function* () {
        const client = yield* makeGmailClient(Redacted.make('access-token'))
        const error = yield* client.getProfile().pipe(Effect.flip)
        expect(error).toMatchObject({
          operation: 'getProfile',
          reason: 'invalid_response',
          statusCode: 200,
        })
      }).pipe(
        Effect.provide(Layer.succeed(HttpClient.HttpClient, fixture.client)),
      )
    },
  )
})
