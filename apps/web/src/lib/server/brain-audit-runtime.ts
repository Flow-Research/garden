import { getAgentByName } from 'agents'
import { Context, Effect, Layer, Schema } from 'effect'
import { disposeRpcResult } from '@garden/app-state/platform/rpc'
import type { AppEnv } from '@/lib/server/env'

type BrainAuditAgentStub = {
  startBrainAudit(input: {
    itemId: string
    text: string
    workspaceId: string
  }): Promise<{ ok: true; status: 'completed' }>
}

const AGENT_ROUTING_RETRY = { maxAttempts: 3 }

const messageFromUnknown = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

export class BrainAuditRequestError extends Schema.TaggedError<BrainAuditRequestError>()(
  'BrainAuditRequestError',
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export interface BrainAuditClientService {
  readonly request: (input: {
    hostName: string
    itemId: string
    text: string
    workspaceId: string
  }) => Effect.Effect<{ ok: true; status: 'completed' }, BrainAuditRequestError>
}

export class BrainAuditClient extends Context.Service<
  BrainAuditClient,
  BrainAuditClientService
>()('@garden/web/BrainAuditClient') {}

/**
 * Adapts Agents SDK routing and callable RPC into one Effect service. The stub
 * remains receiver-bound, RPC results are disposed at the adapter boundary,
 * and callers see one typed transport error instead of Promise rejection.
 */
export const makeBrainAuditClientLayer = (
  agentDo: AppEnv['AgentDO'],
): Layer.Layer<BrainAuditClient> =>
  Layer.succeed(
    BrainAuditClient,
    BrainAuditClient.of({
      request: Effect.fn('BrainAuditClient.request')(function* (input) {
        return yield* Effect.tryPromise({
          try: async () => {
            const stub = (await getAgentByName(agentDo, input.hostName, {
              routingRetry: AGENT_ROUTING_RETRY,
            })) as unknown as BrainAuditAgentStub
            return await disposeRpcResult(
              await stub.startBrainAudit({
                itemId: input.itemId,
                text: input.text,
                workspaceId: input.workspaceId,
              }),
            )
          },
          catch: (cause) =>
            new BrainAuditRequestError({
              operation: 'request workspace brain audit',
              message: messageFromUnknown(cause),
              cause,
            }),
        })
      }),
    }),
  )
