import { Effect, Option, Schema } from 'effect'
import { z } from 'zod'
import {
  ConnectionNotFoundError,
  CredentialResolutionError,
  ElicitationDeclinedError,
  ToolAddress,
  ToolBlockedError,
  ToolInvocationError,
  ToolNotFoundError,
} from '@executor-js/sdk/core'
import type {
  GmailComposeInput,
  GmailDraftDetail,
  GmailDraftSummary,
  GmailEmailSummary,
  GmailListResponse,
  GmailSendResponse,
  GmailView,
} from '@/lib/api/gmail-contract'
import {
  executorProgram,
  type ExecutorIdentity,
  type GardenExecutor,
} from './executor-runtime'

export class GmailServiceError extends Schema.Error<GmailServiceError>(
  'GmailServiceError',
)({
  status: Schema.Number,
  message: Schema.String,
}) {}

const GMAIL_INTEGRATION = 'google_gmail'
const GMAIL_USER = 'me'
const PAGE_SIZE = 10
const DETAIL_CONCURRENCY = 5

const notConnected = (reauth: boolean, detail?: string) =>
  new GmailServiceError({
    status: 409,
    message:
      detail && detail.length > 0
        ? `Gmail needs reconnecting: ${detail}`
        : reauth
          ? 'Gmail needs reconnecting before email can be used.'
          : 'Gmail is not connected.',
  })

const blocked = () =>
  new GmailServiceError({
    status: 403,
    message: 'Workspace policy blocks Gmail access.',
  })

const toolUnavailable = (operation: string) =>
  new GmailServiceError({
    status: 502,
    message: `Gmail operation ${operation} is not available on this connection.`,
  })

const providerFailed = (message: string) =>
  new GmailServiceError({
    status: 502,
    message: message.trim().slice(0, 500) || 'Gmail request failed.',
  })

const mapExecuteError = (operation: string, error: unknown) => {
  if (
    error instanceof ConnectionNotFoundError ||
    error instanceof ElicitationDeclinedError
  ) {
    return notConnected(false)
  }
  if (error instanceof CredentialResolutionError) {
    return notConnected(
      error.reauthRequired === true,
      error.reauthRequired === true ? error.message : undefined,
    )
  }
  if (error instanceof ToolBlockedError) return blocked()
  if (error instanceof ToolNotFoundError) return toolUnavailable(operation)
  if (error instanceof ToolInvocationError) {
    return providerFailed(error.message)
  }
  return new GmailServiceError({
    status: 500,
    message: 'Gmail request failed.',
  })
}

const headerSchema = z
  .object({ name: z.string(), value: z.string() })
  .passthrough()
const payloadSchema: z.ZodType<unknown> = z
  .object({
    headers: z.array(headerSchema).optional(),
    parts: z.array(z.lazy(() => payloadSchema)).optional(),
    body: z.object({ data: z.string().optional() }).passthrough().optional(),
    mimeType: z.string().optional(),
  })
  .passthrough()
const messageSchema = z
  .object({
    id: z.string(),
    threadId: z.string().optional(),
    snippet: z.string().optional(),
    payload: payloadSchema.optional(),
  })
  .passthrough()
const listMessagesSchema = z
  .object({
    messages: z.array(z.object({ id: z.string() }).passthrough()).optional(),
    nextPageToken: z.string().optional(),
  })
  .passthrough()
const draftSchema = z
  .object({ id: z.string(), message: messageSchema })
  .passthrough()
const listDraftsSchema = z
  .object({
    drafts: z.array(draftSchema).optional(),
    nextPageToken: z.string().optional(),
  })
  .passthrough()
const sentMessageSchema = z
  .object({ id: z.string(), threadId: z.string().optional() })
  .passthrough()

const parseProvider = <TSchema extends z.ZodType>(
  operation: string,
  schema: TSchema,
  value: unknown,
): Effect.Effect<z.output<TSchema>, GmailServiceError> => {
  const parsed = schema.safeParse(value)
  if (parsed.success) return Effect.succeed(parsed.data)
  return Effect.fail(
    providerFailed(`Gmail ${operation} returned an unexpected response.`),
  )
}

const unwrapEnvelope = (
  operation: string,
  value: unknown,
): Effect.Effect<unknown, GmailServiceError> => {
  if (value && typeof value === 'object' && 'ok' in value) {
    const envelope = value as { ok?: unknown; data?: unknown }
    if (envelope.ok === true && envelope.data !== undefined) {
      return Effect.succeed(envelope.data)
    }
    return Effect.fail(providerFailed(`Gmail ${operation} failed.`))
  }
  return Effect.succeed(value)
}

const findHeader = (message: z.output<typeof messageSchema>, name: string) => {
  const headers =
    message.payload && typeof message.payload === 'object'
      ? ((
          message.payload as {
            headers?: Array<{ name: string; value: string }>
          }
        ).headers ?? [])
      : []
  return (
    headers.find((header) => header.name.toLowerCase() === name.toLowerCase())
      ?.value ?? ''
  )
}

const splitAddresses = (value: string) =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

type GmailSessionOps = {
  readonly executor: GardenExecutor
  readonly call: (
    operation: string,
    toolName: string,
    args: unknown,
  ) => Effect.Effect<unknown, GmailServiceError>
  readonly addressOf: (
    operation: string,
    toolName: string,
  ) => Effect.Effect<ToolAddress, GmailServiceError>
}

const gmailSession = <A, E>(
  identity: ExecutorIdentity,
  use: (ops: GmailSessionOps) => Effect.Effect<A, E | GmailServiceError>,
) =>
  executorProgram(identity, (executor) =>
    Effect.gen(function* () {
      const tools = yield* executor.tools.list({
        includeBlocked: true,
        includeAnnotations: true,
      })
      const addressOf = (
        operation: string,
        toolName: string,
      ): Effect.Effect<ToolAddress, GmailServiceError> => {
        const match = tools.find(
          (tool) =>
            String(tool.integration) === GMAIL_INTEGRATION &&
            tool.owner === 'user' &&
            String(tool.name) === toolName,
        )
        if (!match) {
          const connected = tools.some(
            (tool) =>
              String(tool.integration) === GMAIL_INTEGRATION &&
              tool.owner === 'user',
          )
          return connected
            ? Effect.fail(toolUnavailable(operation))
            : Effect.fail(notConnected(false))
        }
        return Schema.decodeUnknownEffect(ToolAddress)(
          String(match.address),
        ).pipe(Effect.mapError(() => toolUnavailable(operation)))
      }
      const call = (operation: string, toolName: string, args: unknown) =>
        Effect.flatMap(addressOf(operation, toolName), (address) =>
          executor
            .execute(address, args, {
              onElicitation: 'accept-all',
            })
            .pipe(
              Effect.mapError((error) => mapExecuteError(operation, error)),
            ),
        ).pipe((effect) =>
          Effect.flatMap(effect, (result) => unwrapEnvelope(operation, result)),
        )
      return yield* use({ executor, call, addressOf })
    }),
  )

const toSummary = (
  message: z.output<typeof messageSchema>,
  draftId: string | null,
): GmailEmailSummary => ({
  id: message.id,
  threadId: message.threadId ?? null,
  subject: findHeader(message, 'Subject') || '(no subject)',
  snippet: message.snippet ?? '',
  from: findHeader(message, 'From'),
  to: findHeader(message, 'To'),
  date: findHeader(message, 'Date') || null,
  ...(draftId ? { draftId } : {}),
})

const getMessage = (
  call: GmailSessionOps['call'],
  id: string,
  format: 'METADATA' | 'FULL',
) =>
  Effect.gen(function* () {
    const raw = yield* call('read message', 'gmail.users.messages.get', {
      userId: GMAIL_USER,
      id,
      format,
      metadataHeaders: ['Subject', 'From', 'To', 'Date'],
    })
    return yield* parseProvider('read message', messageSchema, raw)
  })

const getDraftMessage = (call: GmailSessionOps['call'], id: string) =>
  Effect.gen(function* () {
    const raw = yield* call('read draft', 'gmail.users.drafts.get', {
      userId: GMAIL_USER,
      id,
      format: 'FULL',
    })
    return yield* parseProvider('read draft', draftSchema, raw)
  })

const decodeBase64Url = (value: string) => {
  const padded = value.padEnd(
    value.length + ((4 - (value.length % 4)) % 4),
    '=',
  )
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

const findPlainBody = (payload: unknown): string | null => {
  if (!payload || typeof payload !== 'object') return null
  const node = payload as {
    mimeType?: string
    body?: { data?: string }
    parts?: unknown[]
  }
  if (
    (node.mimeType === 'text/plain' || node.mimeType?.startsWith('text/')) &&
    node.body?.data
  ) {
    try {
      return decodeBase64Url(node.body.data)
    } catch {
      return null
    }
  }
  for (const part of node.parts ?? []) {
    const found = findPlainBody(part)
    if (found !== null) return found
  }
  return null
}

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

const bytesToBase64Url = (bytes: Uint8Array) =>
  bytesToBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')

const encodeHeader = (value: string) =>
  /[^\x20-\x7e]/.test(value)
    ? `=?UTF-8?B?${bytesToBase64(new TextEncoder().encode(value))}?=`
    : value

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const markdownToPlain = (value: string) =>
  value.replace(/\[([^\]]*)\]\(([^)]+)\)/g, '$1 ($2)')

const markdownToHtml = (value: string) =>
  escapeHtml(value)
    .replace(
      /\[([^\]]*)\]\(([^)]+)\)/g,
      (_match, label: string, href: string) => {
        const safe = /^https?:\/\//i.test(href) ? escapeHtml(href) : '#'
        return `<a href="${safe}">${label}</a>`
      },
    )
    .replace(/\n/g, '<br>')

const buildRawMessage = (input: GmailComposeInput) => {
  const boundary = `garden-${crypto.randomUUID()}`
  const plain = markdownToPlain(input.body)
  const html = markdownToHtml(input.body)
  const lines = [
    `To: ${input.to.join(', ')}`,
    ...(input.cc.length > 0 ? [`Cc: ${input.cc.join(', ')}`] : []),
    ...(input.bcc.length > 0 ? [`Bcc: ${input.bcc.join(', ')}`] : []),
    `Subject: ${encodeHeader(input.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    plain,
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    '',
    `<div>${html}</div>`,
    `--${boundary}--`,
  ]
  return bytesToBase64Url(new TextEncoder().encode(lines.join('\r\n')))
}

export const listGmail = Effect.fn('Gmail.list')(function* (
  identity: ExecutorIdentity,
  view: GmailView,
  cursor?: string,
) {
  return yield* gmailSession(identity, ({ call }) =>
    Effect.gen(function* () {
      if (view === 'drafts') {
        const raw = yield* call('list drafts', 'gmail.users.drafts.list', {
          userId: GMAIL_USER,
          maxResults: PAGE_SIZE,
          ...(cursor ? { pageToken: cursor } : {}),
        })
        const page = yield* parseProvider('list drafts', listDraftsSchema, raw)
        const items = yield* Effect.forEach(
          page.drafts ?? [],
          (draft) =>
            Effect.gen(function* () {
              const full = yield* getDraftMessage(call, draft.id)
              return {
                ...toSummary(full.message, full.id),
                draftId: full.id,
              } satisfies GmailDraftSummary
            }),
          { concurrency: DETAIL_CONCURRENCY },
        )
        const response: GmailListResponse = {
          items,
          nextCursor: page.nextPageToken ?? null,
        }
        return response
      }
      const raw = yield* call('list sent', 'gmail.users.messages.list', {
        userId: GMAIL_USER,
        q: 'in:sent',
        maxResults: PAGE_SIZE,
        ...(cursor ? { pageToken: cursor } : {}),
      })
      const page = yield* parseProvider('list sent', listMessagesSchema, raw)
      const items = yield* Effect.forEach(
        page.messages ?? [],
        (entry) =>
          Effect.gen(function* () {
            const message = yield* getMessage(call, entry.id, 'METADATA')
            return toSummary(message, null)
          }),
        { concurrency: DETAIL_CONCURRENCY },
      )
      const response: GmailListResponse = {
        items,
        nextCursor: page.nextPageToken ?? null,
      }
      return response
    }),
  )
})

export const getGmailMessage = Effect.fn('Gmail.getMessage')(function* (
  identity: ExecutorIdentity,
  id: string,
) {
  return yield* gmailSession(identity, ({ call }) =>
    Effect.gen(function* () {
      const message = yield* getMessage(call, id, 'METADATA')
      return toSummary(message, null)
    }),
  )
})

export const getGmailDraft = Effect.fn('Gmail.getDraft')(function* (
  identity: ExecutorIdentity,
  draftId: string,
) {
  return yield* gmailSession(identity, ({ call }) =>
    Effect.gen(function* () {
      const draft = yield* getDraftMessage(call, draftId)
      const message = draft.message
      const detail: GmailDraftDetail = {
        draftId: draft.id,
        to: splitAddresses(findHeader(message, 'To')),
        cc: splitAddresses(findHeader(message, 'Cc')),
        bcc: splitAddresses(findHeader(message, 'Bcc')),
        subject: findHeader(message, 'Subject'),
        bodyText:
          (message.payload ? findPlainBody(message.payload) : null) ??
          message.snippet ??
          '',
      }
      return detail
    }),
  )
})

export const saveGmailDraft = Effect.fn('Gmail.saveDraft')(function* (
  identity: ExecutorIdentity,
  input: GmailComposeInput,
) {
  return yield* gmailSession(identity, ({ call }) =>
    Effect.gen(function* () {
      const raw = buildRawMessage(input)
      if (input.draftId) {
        const updated = yield* call(
          'update draft',
          'gmail.users.drafts.update',
          {
            userId: GMAIL_USER,
            id: input.draftId,
            body: { message: { raw } },
          },
        )
        const parsed = yield* parseProvider(
          'update draft',
          draftSchema,
          updated,
        )
        const detail: GmailDraftDetail = {
          draftId: parsed.id,
          to: [...input.to],
          cc: [...input.cc],
          bcc: [...input.bcc],
          subject: input.subject,
          bodyText: input.body,
        }
        return detail
      }
      const created = yield* call('create draft', 'gmail.users.drafts.create', {
        userId: GMAIL_USER,
        body: { message: { raw } },
      })
      const parsed = yield* parseProvider('create draft', draftSchema, created)
      const detail: GmailDraftDetail = {
        draftId: parsed.id,
        to: [...input.to],
        cc: [...input.cc],
        bcc: [...input.bcc],
        subject: input.subject,
        bodyText: input.body,
      }
      return detail
    }),
  )
})

export const deleteGmailDraft = Effect.fn('Gmail.deleteDraft')(function* (
  identity: ExecutorIdentity,
  draftId: string,
) {
  return yield* gmailSession(identity, ({ call }) =>
    call('delete draft', 'gmail.users.drafts.delete', {
      userId: GMAIL_USER,
      id: draftId,
    }),
  )
})

export const sendGmail = Effect.fn('Gmail.send')(function* (
  identity: ExecutorIdentity,
  input: GmailComposeInput,
) {
  return yield* gmailSession(identity, ({ executor, call, addressOf }) =>
    Effect.gen(function* () {
      if (input.draftId) {
        const draftSendAddress = yield* Effect.option(
          addressOf('send draft', 'gmail.users.drafts.send'),
        )
        if (Option.isSome(draftSendAddress)) {
          const direct = yield* executor
            .execute(
              draftSendAddress.value,
              {
                userId: GMAIL_USER,
                body: { id: input.draftId },
              },
              {
                onElicitation: 'accept-all',
              },
            )
            .pipe(
              Effect.mapError((error) => mapExecuteError('send draft', error)),
            )
          const unwrapped = yield* unwrapEnvelope('send draft', direct)
          const parsed = yield* parseProvider(
            'send draft',
            sentMessageSchema,
            unwrapped,
          )
          const response: GmailSendResponse = {
            id: parsed.id,
            draftId: input.draftId,
          }
          return response
        }
      }
      const raw = buildRawMessage(input)
      const sent = yield* call('send message', 'gmail.users.messages.send', {
        userId: GMAIL_USER,
        body: { raw },
      })
      const parsed = yield* parseProvider(
        'send message',
        sentMessageSchema,
        sent,
      )
      if (input.draftId) {
        yield* call('delete draft', 'gmail.users.drafts.delete', {
          userId: GMAIL_USER,
          id: input.draftId,
        }).pipe(Effect.ignore)
      }
      const response: GmailSendResponse = {
        id: parsed.id,
        draftId: input.draftId ?? null,
      }
      return response
    }),
  )
})
