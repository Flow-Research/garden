import { APICallError, generateText } from 'ai'
import { Result } from 'better-result'
import {
  createAgentModel,
  resolveAgentModelProfile,
  type AgentModelEnv,
  type AgentModelProvider,
} from './model'

/** Why a model health probe did not return a usable answer. */
export type AgentModelHealthFailure =
  | 'timeout'
  | 'unavailable'
  | 'provider_error'
  | 'invalid_response'
  | 'configuration_error'

export type AgentModelHealthStatus = 'healthy' | AgentModelHealthFailure

/** One probe of the model Garden agents run on, safe to log and email. */
export type AgentModelHealthReport = {
  status: AgentModelHealthStatus
  provider: AgentModelProvider
  modelId: string
  durationMs: number
  /** The AI SDK finish reason, when the provider answered. */
  finishReason?: string
  /** Failure detail from the probe. Provider response messages are excluded. */
  detail?: string
}

export type AgentModelHealthProbeInput = {
  /** Typed as required by the Worker env, but checked: a binding can be absent at runtime. */
  ai: Ai
  env: AgentModelEnv
  gatewayId?: string
  timeoutMs: number
}

/**
 * The prompt asks for one word so the probe tests inference, not model
 * quality. Any non-empty text counts as healthy: an exact-match check would
 * page the team when a model phrases "OK" differently.
 */
const PROBE_PROMPT = 'Reply with the single word OK.'
const USABLE_FINISH_REASONS = new Set(['stop', 'length'])

type ProbeFailure = {
  status: AgentModelHealthFailure
  detail: string
}

/**
 * Sends one short prompt to the model that agent turns use, resolved through
 * `resolveAgentModelProfile` and built by `createAgentModel`, so the probe can
 * never drift from the runtime model. It runs no agent, tools, or Workflow and
 * writes nothing. Every outcome, including a timeout or a thrown provider
 * error, is returned as a report: an unhealthy model is a normal result for a
 * monitor, not an exception.
 */
export async function probeAgentModel(
  input: AgentModelHealthProbeInput,
): Promise<AgentModelHealthReport> {
  const profile = resolveAgentModelProfile(input.env)
  const startedAt = Date.now()
  const report = (
    fields: Pick<AgentModelHealthReport, 'status'> &
      Partial<AgentModelHealthReport>,
  ): AgentModelHealthReport => ({
    provider: profile.provider,
    modelId: profile.id,
    durationMs: Math.max(0, Date.now() - startedAt),
    ...fields,
  })

  if (profile.provider === 'workers-ai' && !input.ai) {
    return report({
      status: 'configuration_error',
      detail: 'The Workers AI binding `AI` is not bound to this Worker.',
    })
  }

  let retired = false
  const model = Result.try(() =>
    createAgentModel({
      ai: input.ai,
      env: input.env,
      gatewayId: input.gatewayId,
      profile,
      onModelRetired: () => {
        retired = true
      },
    }),
  )
  if (model.isErr()) {
    return report({
      status: 'configuration_error',
      detail: describeError(model.error),
    })
  }

  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), input.timeoutMs)
  const generation = await Result.tryPromise({
    try: async () =>
      await settleBefore(
        timeout.signal,
        generateText({
          model: model.value,
          prompt: PROBE_PROMPT,
          // The AI SDK retries twice by default. A monitor must report the
          // first failure, not hide an outage or triple the provider calls.
          maxRetries: 0,
          abortSignal: timeout.signal,
        }),
      ),
    catch: (cause) => cause,
  })
  clearTimeout(timer)

  return generation.match({
    ok: (result) => {
      const failure = invalidResponse(result.text, result.finishReason)
      return report({
        status: failure ? 'invalid_response' : 'healthy',
        finishReason: result.finishReason,
        ...(failure ? { detail: failure } : {}),
      })
    },
    err: (cause) =>
      report(
        timeout.signal.aborted
          ? {
              status: 'timeout',
              detail: `No answer within ${input.timeoutMs} ms.`,
            }
          : classifyProviderError(cause, retired),
      ),
  })
}

/**
 * Rejects when `signal` aborts even if the provider ignores the signal, so a
 * hung binding call cannot outlive the probe's bound.
 */
export function settleBefore<T>(signal: AbortSignal, work: Promise<T>) {
  return new Promise<T>((resolve, reject) => {
    work.then(resolve, reject)
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    signal.addEventListener('abort', () => reject(signal.reason), {
      once: true,
    })
  })
}

function invalidResponse(text: string, finishReason: string) {
  if (!USABLE_FINISH_REASONS.has(finishReason)) {
    return `The model finished with reason "${finishReason}".`
  }
  if (text.trim() === '') return 'The model returned no text.'
  return null
}

function classifyProviderError(cause: unknown, retired: boolean): ProbeFailure {
  const detail = describeError(cause)
  // `observeRetiredAgentModel` (wired by createAgentModel) recognizes Workers
  // AI retirement errors (5028 / "Model has been deprecated").
  if (retired) return { status: 'unavailable', detail }
  if (APICallError.isInstance(cause)) {
    const status = cause.statusCode
    if (status === 401 || status === 403) {
      return { status: 'configuration_error', detail }
    }
    if (status === 404 || status === 410) {
      return { status: 'unavailable', detail }
    }
  }
  return { status: 'provider_error', detail }
}

function describeError(cause: unknown) {
  if (APICallError.isInstance(cause) && Number.isInteger(cause.statusCode)) {
    return `Model request failed (HTTP ${cause.statusCode}).`
  }
  return 'Model request failed.'
}
