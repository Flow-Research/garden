import { and, desc, eq } from 'drizzle-orm'
import { Result, TaggedError } from 'better-result'
import { getConnectorById } from '@garden/connectors'
import type { ConnectorId } from '@garden/connectors/registry'
import { schema, type Db } from '@/lib/server/db'

type ConnectorCallbackEventDb = Db

export type ConnectorCallbackSource = 'oauth' | 'github_app' | 'discord_bot'
export type ConnectorCallbackStatus = 'success' | 'degraded' | 'error'

type ConnectorCallbackPayload = Record<string, unknown>

export class ConnectorCallbackDatabaseError extends TaggedError(
  'ConnectorCallbackDatabaseError',
)<{
  operation: 'insert' | 'select' | 'update'
  message: string
  cause: unknown
}>() {}

export class ConnectorCallbackEventNotFound extends TaggedError(
  'ConnectorCallbackEventNotFound',
)<{
  flowId: string
  message: string
}>() {}

export type ConnectorCallbackEventError =
  | ConnectorCallbackDatabaseError
  | ConnectorCallbackEventNotFound

export type ConnectorCallbackEventView = {
  id: string
  connectorId: ConnectorId
  connectorLabel: string
  providerId: string | null
  flowId: string | null
  source: ConnectorCallbackSource
  status: ConnectorCallbackStatus
  stage: string
  message: string | null
  errorCode: string | null
  accountLogin: string | null
  createdAt: string
  completedAt: string | null
}

function toConnectorCallbackEventView(
  event: typeof schema.connectorCallbackEvent.$inferSelect,
): ConnectorCallbackEventView {
  const connector = getConnectorById(event.connectorId)
  return {
    id: event.id,
    connectorId: event.connectorId as ConnectorId,
    connectorLabel: connector?.label ?? event.connectorId,
    providerId: event.providerId,
    flowId: event.flowId,
    source: event.source as ConnectorCallbackSource,
    status: event.status as ConnectorCallbackStatus,
    stage: event.stage,
    message: event.message,
    errorCode: event.errorCode,
    accountLogin: event.accountLogin,
    createdAt: event.createdAt.toISOString(),
    completedAt: event.completedAt ? event.completedAt.toISOString() : null,
  }
}

function databaseError(
  operation: ConnectorCallbackDatabaseError['operation'],
  cause: unknown,
  fallback: string,
) {
  return new ConnectorCallbackDatabaseError({
    operation,
    cause,
    message: cause instanceof Error ? cause.message : fallback,
  })
}

/**
 * Persists the product-level connector callback outcome that Workers logs cannot
 * safely model. Before this, OAuth/GitHub callbacks only mutated account rows
 * and the UI guessed from URL flags, so callback UX broke when the URL no
 * longer opened a tab. This ledger gives the workspace shell a one-shot event
 * to consume without reintroducing tab state in search params. References:
 * TanStack Start server routes for callback handlers, Better Auth OAuth hooks,
 * and Cloudflare Workers structured logs/observability docs.
 */
export async function recordConnectorCallbackEvent(args: {
  db: ConnectorCallbackEventDb
  workspaceId: string
  userId: string
  connectorId: ConnectorId
  providerId?: string | null
  flowId?: string | null
  source: ConnectorCallbackSource
  status: ConnectorCallbackStatus
  stage?: string
  message?: string | null
  errorCode?: string | null
  accountLogin?: string | null
  payload?: ConnectorCallbackPayload | null
}) {
  const now = new Date()
  const result = await Result.tryPromise({
    try: async () => {
      const [event] = await args.db
        .insert(schema.connectorCallbackEvent)
        .values({
          workspaceId: args.workspaceId,
          userId: args.userId,
          connectorId: args.connectorId,
          providerId: args.providerId ?? null,
          flowId: args.flowId ?? null,
          source: args.source,
          status: args.status,
          stage: args.stage ?? 'callback',
          message: args.message ?? null,
          errorCode: args.errorCode ?? null,
          accountLogin: args.accountLogin ?? null,
          payload: args.payload ?? null,
          completedAt: now,
        })
        .returning()
      return event ? toConnectorCallbackEventView(event) : null
    },
    catch: (cause) =>
      databaseError('insert', cause, 'Failed to record callback event'),
  })

  return result.andThen((event) =>
    event
      ? Result.ok(event)
      : Result.err(
          new ConnectorCallbackDatabaseError({
            operation: 'insert',
            cause: null,
            message: 'Callback event was not returned after insert',
          }),
        ),
  )
}

/**
 * Reads the single callback outcome referenced by a browser return flow. The
 * caller already proved workspace access; this helper scopes by workspace and
 * flow id so another tab's connector callback cannot be shown accidentally.
 */
export async function getConnectorCallbackEventByFlow(args: {
  db: ConnectorCallbackEventDb
  workspaceId: string
  flowId: string
  connectorId?: ConnectorId | null
}) {
  const result = await Result.tryPromise({
    try: async () => {
      const filters = [
        eq(schema.connectorCallbackEvent.workspaceId, args.workspaceId),
        eq(schema.connectorCallbackEvent.flowId, args.flowId),
      ]
      if (args.connectorId) {
        filters.push(eq(schema.connectorCallbackEvent.connectorId, args.connectorId))
      }

      const [event] = await args.db
        .select()
        .from(schema.connectorCallbackEvent)
        .where(and(...filters))
        .orderBy(desc(schema.connectorCallbackEvent.createdAt))
        .limit(1)

      return event ? toConnectorCallbackEventView(event) : null
    },
    catch: (cause) =>
      databaseError('select', cause, 'Failed to load callback event'),
  })

  return result.andThen((event) =>
    event
      ? Result.ok(event)
      : Result.err(
          new ConnectorCallbackEventNotFound({
            flowId: args.flowId,
            message: 'Connector callback event not found',
          }),
        ),
  )
}

export function connectorCallbackSearchParams(args: {
  flowId?: string | null
  connectorId: ConnectorId
}) {
  const params = new URLSearchParams()
  if (args.flowId) params.set('connector_flow', args.flowId)
  params.set('connector_id', args.connectorId)
  return params
}
