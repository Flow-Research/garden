import { Context, Effect, Layer, Redacted, Schema } from 'effect'
import * as HttpClient from 'effect/unstable/http/HttpClient'
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse'

const GMAIL_API_BASE_URL = 'https://gmail.googleapis.com/gmail/v1'

const NonEmptyString = Schema.Trim.check(Schema.isMinLength(1))
const GmailPageSize = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(500),
)

export const GmailListMessagesInput = Schema.Struct({
  maxResults: Schema.optionalKey(GmailPageSize),
  pageToken: Schema.optionalKey(NonEmptyString),
  query: Schema.optionalKey(Schema.String),
  labelIds: Schema.optionalKey(Schema.Array(NonEmptyString)),
  includeSpamTrash: Schema.optionalKey(Schema.Boolean),
})
export interface GmailListMessagesInput extends Schema.Schema.Type<
  typeof GmailListMessagesInput
> {}

export const GmailMessageReference = Schema.Struct({
  id: NonEmptyString,
  threadId: NonEmptyString,
})
export interface GmailMessageReference extends Schema.Schema.Type<
  typeof GmailMessageReference
> {}

export const GmailListMessagesResponse = Schema.Struct({
  messages: Schema.optionalKey(Schema.Array(GmailMessageReference)),
  nextPageToken: Schema.optionalKey(NonEmptyString),
  resultSizeEstimate: Schema.optionalKey(Schema.Number),
})
export interface GmailListMessagesResponse extends Schema.Schema.Type<
  typeof GmailListMessagesResponse
> {}

export const GmailProfile = Schema.Struct({
  emailAddress: NonEmptyString,
  messagesTotal: Schema.Number,
  threadsTotal: Schema.Number,
  historyId: NonEmptyString,
})
export interface GmailProfile extends Schema.Schema.Type<typeof GmailProfile> {}

export const GmailRawMessage = Schema.Struct({
  id: NonEmptyString,
  threadId: NonEmptyString,
  labelIds: Schema.optionalKey(Schema.Array(NonEmptyString)),
  historyId: NonEmptyString,
  internalDate: NonEmptyString,
  sizeEstimate: Schema.optionalKey(Schema.Number),
  raw: NonEmptyString,
})
export interface GmailRawMessage extends Schema.Schema.Type<
  typeof GmailRawMessage
> {}

/** Gmail accepts complete RFC 5322 bytes encoded as base64url. */
export const GmailSendMessageInput = Schema.Struct({
  raw: NonEmptyString,
  threadId: Schema.optionalKey(NonEmptyString),
})
export interface GmailSendMessageInput extends Schema.Schema.Type<
  typeof GmailSendMessageInput
> {}

export const GmailSendMessageResponse = Schema.Struct({
  id: NonEmptyString,
  threadId: NonEmptyString,
  labelIds: Schema.optionalKey(Schema.Array(NonEmptyString)),
})
export interface GmailSendMessageResponse extends Schema.Schema.Type<
  typeof GmailSendMessageResponse
> {}

export const GmailModifyMessageInput = Schema.Struct({
  messageId: NonEmptyString,
  addLabelIds: Schema.Array(NonEmptyString),
  removeLabelIds: Schema.Array(NonEmptyString),
})
export interface GmailModifyMessageInput extends Schema.Schema.Type<
  typeof GmailModifyMessageInput
> {}

export const GmailModifyMessageResponse = Schema.Struct({
  id: NonEmptyString,
  threadId: NonEmptyString,
  labelIds: Schema.optionalKey(Schema.Array(NonEmptyString)),
})
export interface GmailModifyMessageResponse extends Schema.Schema.Type<
  typeof GmailModifyMessageResponse
> {}

export const GmailHistoryType = Schema.Literals([
  'messageAdded',
  'messageDeleted',
  'labelAdded',
  'labelRemoved',
])
export type GmailHistoryType = typeof GmailHistoryType.Type

export const GmailListHistoryInput = Schema.Struct({
  startHistoryId: NonEmptyString,
  maxResults: Schema.optionalKey(GmailPageSize),
  pageToken: Schema.optionalKey(NonEmptyString),
  labelId: Schema.optionalKey(NonEmptyString),
  historyTypes: Schema.optionalKey(Schema.Array(GmailHistoryType)),
})
export interface GmailListHistoryInput extends Schema.Schema.Type<
  typeof GmailListHistoryInput
> {}

const GmailHistoryMessage = GmailMessageReference.pipe(
  Schema.fieldsAssign({
    labelIds: Schema.optionalKey(Schema.Array(NonEmptyString)),
  }),
)

const GmailHistoryMessageChange = Schema.Struct({
  message: GmailHistoryMessage,
})

const GmailHistoryLabelChange = Schema.Struct({
  message: GmailHistoryMessage,
  labelIds: Schema.Array(NonEmptyString),
})

export const GmailHistoryRecord = Schema.Struct({
  id: NonEmptyString,
  messages: Schema.optionalKey(Schema.Array(GmailHistoryMessage)),
  messagesAdded: Schema.optionalKey(Schema.Array(GmailHistoryMessageChange)),
  messagesDeleted: Schema.optionalKey(Schema.Array(GmailHistoryMessageChange)),
  labelsAdded: Schema.optionalKey(Schema.Array(GmailHistoryLabelChange)),
  labelsRemoved: Schema.optionalKey(Schema.Array(GmailHistoryLabelChange)),
})
export interface GmailHistoryRecord extends Schema.Schema.Type<
  typeof GmailHistoryRecord
> {}

export const GmailListHistoryResponse = Schema.Struct({
  history: Schema.optionalKey(Schema.Array(GmailHistoryRecord)),
  nextPageToken: Schema.optionalKey(NonEmptyString),
  historyId: NonEmptyString,
})
export interface GmailListHistoryResponse extends Schema.Schema.Type<
  typeof GmailListHistoryResponse
> {}

export const GmailApiOperation = Schema.Literals([
  'listMessages',
  'getProfile',
  'getRawMessage',
  'listHistory',
  'sendMessage',
  'modifyMessage',
])
export type GmailApiOperation = typeof GmailApiOperation.Type

export class GmailApiError extends Schema.TaggedErrorClass<GmailApiError>()(
  'GmailApiError',
  {
    operation: GmailApiOperation,
    reason: Schema.Literals([
      'transport',
      'unauthorized',
      'forbidden',
      'not_found',
      'rejected',
      'invalid_response',
    ]),
    statusCode: Schema.optionalKey(Schema.Number),
    message: Schema.String,
  },
) {}

export interface GmailClientService {
  readonly listMessages: (
    input: GmailListMessagesInput,
  ) => Effect.Effect<GmailListMessagesResponse, GmailApiError>
  readonly getProfile: () => Effect.Effect<GmailProfile, GmailApiError>
  readonly getRawMessage: (
    messageId: string,
  ) => Effect.Effect<GmailRawMessage, GmailApiError>
  readonly listHistory: (
    input: GmailListHistoryInput,
  ) => Effect.Effect<GmailListHistoryResponse, GmailApiError>
  readonly sendMessage: (
    input: GmailSendMessageInput,
  ) => Effect.Effect<GmailSendMessageResponse, GmailApiError>
  readonly modifyMessage: (
    input: GmailModifyMessageInput,
  ) => Effect.Effect<GmailModifyMessageResponse, GmailApiError>
}

export class GmailClient extends Context.Service<
  GmailClient,
  GmailClientService
>()('@garden/server/GmailClient') {}

/** Classifies provider status without decoding or retaining Gmail error bodies. */
const rejectedResponse = (
  operation: GmailApiOperation,
  statusCode: number,
): GmailApiError => {
  if (statusCode === 401) {
    return new GmailApiError({
      operation,
      reason: 'unauthorized',
      statusCode,
      message: 'Gmail rejected the connected account credential.',
    })
  }
  if (statusCode === 403) {
    return new GmailApiError({
      operation,
      reason: 'forbidden',
      statusCode,
      message: 'The connected Gmail account does not permit this operation.',
    })
  }
  if (statusCode === 404) {
    return new GmailApiError({
      operation,
      reason: 'not_found',
      statusCode,
      message: 'The requested Gmail resource was not found.',
    })
  }
  return new GmailApiError({
    operation,
    reason: 'rejected',
    statusCode,
    message: 'Gmail rejected the API request.',
  })
}

/** Executes one read-only Gmail request and decodes only its successful body. */
const executeJson = <S extends Schema.Constraint>(
  client: HttpClient.HttpClient,
  operation: GmailApiOperation,
  request: HttpClientRequest.HttpClientRequest,
  responseSchema: S,
): Effect.Effect<S['Type'], GmailApiError, S['DecodingServices']> =>
  client.execute(request).pipe(
    Effect.mapError(
      () =>
        new GmailApiError({
          operation,
          reason: 'transport',
          message: 'The Gmail API request could not be completed.',
        }),
    ),
    Effect.flatMap((response) => {
      if (response.status < 200 || response.status >= 300) {
        return Effect.fail(rejectedResponse(operation, response.status))
      }
      return HttpClientResponse.schemaBodyJson(responseSchema)(response).pipe(
        Effect.mapError(
          () =>
            new GmailApiError({
              operation,
              reason: 'invalid_response',
              statusCode: response.status,
              message: 'Gmail returned an invalid API response.',
            }),
        ),
      )
    }),
  )

/**
 * Builds a request-local Gmail REST client around a redacted access token.
 * Retry belongs to the caller's durable boundary: Cloudflare Workflow retries
 * background reads while interactive profile checks return promptly.
 */
export const makeGmailClient = Effect.fn('GmailClient.make')(function* (
  accessToken: Redacted.Redacted<string>,
) {
  const baseClient = yield* HttpClient.HttpClient
  const client = baseClient.pipe(
    HttpClient.mapRequest((request) =>
      request.pipe(
        HttpClientRequest.prependUrl(GMAIL_API_BASE_URL),
        HttpClientRequest.bearerToken(accessToken),
        HttpClientRequest.acceptJson,
      ),
    ),
  )

  return GmailClient.of({
    listMessages: Effect.fn('GmailClient.listMessages')(function* (input) {
      const request = HttpClientRequest.get('/users/me/messages').pipe(
        HttpClientRequest.appendUrlParams({
          maxResults: input.maxResults,
          pageToken: input.pageToken,
          q: input.query,
          labelIds: input.labelIds,
          includeSpamTrash: input.includeSpamTrash,
        }),
      )
      return yield* executeJson(
        client,
        'listMessages',
        request,
        GmailListMessagesResponse,
      )
    }),
    getProfile: Effect.fn('GmailClient.getProfile')(function* () {
      return yield* executeJson(
        client,
        'getProfile',
        HttpClientRequest.get('/users/me/profile'),
        GmailProfile,
      )
    }),
    getRawMessage: Effect.fn('GmailClient.getRawMessage')(
      function* (messageId) {
        const request = HttpClientRequest.get(
          `/users/me/messages/${encodeURIComponent(messageId)}`,
        ).pipe(HttpClientRequest.appendUrlParam('format', 'raw'))
        return yield* executeJson(
          client,
          'getRawMessage',
          request,
          GmailRawMessage,
        )
      },
    ),
    listHistory: Effect.fn('GmailClient.listHistory')(function* (input) {
      const request = HttpClientRequest.get('/users/me/history').pipe(
        HttpClientRequest.appendUrlParams({
          startHistoryId: input.startHistoryId,
          maxResults: input.maxResults,
          pageToken: input.pageToken,
          labelId: input.labelId,
          historyTypes: input.historyTypes,
        }),
      )
      return yield* executeJson(
        client,
        'listHistory',
        request,
        GmailListHistoryResponse,
      )
    }),
    sendMessage: Effect.fn('GmailClient.sendMessage')(function* (input) {
      const request = yield* HttpClientRequest.schemaBodyJson(
        GmailSendMessageInput,
      )(HttpClientRequest.post('/users/me/messages/send'), input).pipe(
        Effect.mapError(
          () =>
            new GmailApiError({
              operation: 'sendMessage',
              reason: 'invalid_response',
              message: 'Gmail send request could not be encoded.',
            }),
        ),
      )
      return yield* executeJson(
        client,
        'sendMessage',
        request,
        GmailSendMessageResponse,
      )
    }),
    modifyMessage: Effect.fn('GmailClient.modifyMessage')(function* (input) {
      const body = {
        addLabelIds: input.addLabelIds,
        removeLabelIds: input.removeLabelIds,
      }
      const request = yield* HttpClientRequest.schemaBodyJson(
        Schema.Struct({
          addLabelIds: Schema.Array(NonEmptyString),
          removeLabelIds: Schema.Array(NonEmptyString),
        }),
      )(
        HttpClientRequest.post(
          `/users/me/messages/${encodeURIComponent(input.messageId)}/modify`,
        ),
        body,
      ).pipe(
        Effect.mapError(
          () =>
            new GmailApiError({
              operation: 'modifyMessage',
              reason: 'invalid_response',
              message: 'Gmail label mutation could not be encoded.',
            }),
        ),
      )
      return yield* executeJson(
        client,
        'modifyMessage',
        request,
        GmailModifyMessageResponse,
      )
    }),
  })
})

/** Supplies GmailClient for one request-scoped redacted credential. */
export const makeGmailClientLayer = (accessToken: Redacted.Redacted<string>) =>
  Layer.effect(GmailClient, makeGmailClient(accessToken))
