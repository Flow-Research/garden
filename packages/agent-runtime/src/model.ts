import type { LanguageModel } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { withTracing } from '@posthog/ai/vercel'
import { PostHog } from 'posthog-node'
import { createWorkersAI } from 'workers-ai-provider'
import { resolveGardenAnalyticsEnvironment } from '@garden/observability/analytics/events'
import { traceV4Model } from './model-v4-tracing'
import { observeRetiredAgentModel } from './model-retirement'

// Grant-bearing generation telemetry has a fixed metadata boundary. New SDK
// content/error fields remain excluded until they receive an explicit review.
const generationMetadataKeys = new Set([
  '$ai_model',
  '$ai_provider',
  '$ai_trace_id',
  '$ai_session_id',
  '$ai_span_id',
  '$ai_parent_id',
  '$ai_span_name',
  '$ai_latency',
  '$ai_input_tokens',
  '$ai_output_tokens',
  '$ai_total_tokens',
  '$ai_input_cost_usd',
  '$ai_output_cost_usd',
  '$ai_total_cost_usd',
  '$ai_cache_read_input_tokens',
  '$ai_cache_creation_input_tokens',
  '$ai_is_error',
  '$ai_http_status',
  '$groups',
  'environment',
  'workspace_id',
  'garden_runtime_kind',
  'agent_id',
  'thread_id',
  'issue_id',
  'run_id',
  'automation_id',
])

const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com'

export type AgentModelProvider = 'workers-ai' | 'openai-compatible'

/**
 * Env slice that selects and configures the agent model provider.
 *
 * Why: the offline local-dev mode (2026-08 DX work, see
 * .jarvis/context/private/julian/garden/2026-08-14-offline-local-dev-mode-plan.md)
 * routes model calls to any OpenAI-compatible endpoint (Ollama by default)
 * instead of the remote Workers AI binding, so contributors can run Garden
 * with no Cloudflare account. Delivered to the worker via dev.mjs process env
 * (CLOUDFLARE_INCLUDE_PROCESS_ENV). Shared by the three DO runtimes so the
 * field list lives in exactly one place.
 */
export type AgentModelEnv = {
  GARDEN_OFFLINE?: string
  GARDEN_MODEL_PROVIDER?: string
  GARDEN_MODEL_BASE_URL?: string
  GARDEN_MODEL_ID?: string
  GARDEN_MODEL_API_KEY?: string
  GARDEN_MODEL_CONTEXT_WINDOW_TOKENS?: string
}

export type AgentModelCompactionPolicy = {
  responseReserveTokens: number
  tailTokenBudgetTokens: number
  thresholdTokens: number
}

export type AgentModelProfile = {
  contextWindowTokens: number
  docs: string
  id: string
  maxOutputTokens: number
  provider: AgentModelProvider
  compaction: AgentModelCompactionPolicy
  pricePerToken: {
    cacheReadInput: number
    input: number
    output: number
  }
  /** Workers AI `reasoning_effort`; omitted for providers that do not take it. */
  reasoningEffort?: 'low' | 'medium' | 'high'
}

export type AgentModelTracing = {
  privacyMode?: boolean
  distinctId: string
  traceId: string
  workspaceId: string
  properties: Record<string, unknown>
  waitUntil: (promise: Promise<unknown>) => void
}

type AgentModelConfig = {
  ai: Ai
  env?: AgentModelEnv & {
    ENVIRONMENT?: string
    VITE_PUBLIC_POSTHOG_HOST?: string
    VITE_PUBLIC_POSTHOG_PROJECT_TOKEN?: string
  }
  gatewayId?: string
  onModelRetired?: () => void
  profile?: AgentModelProfile
  tracing?: AgentModelTracing
}

const PI_DEFAULT_RESPONSE_RESERVE_TOKENS = 16_384
const PI_DEFAULT_COMPACTION_TAIL_TOKENS = 20_000

const createPiStyleCompactionPolicy = (
  contextWindowTokens: number,
): AgentModelCompactionPolicy => ({
  responseReserveTokens: PI_DEFAULT_RESPONSE_RESERVE_TOKENS,
  tailTokenBudgetTokens: PI_DEFAULT_COMPACTION_TAIL_TOKENS,
  thresholdTokens: contextWindowTokens - PI_DEFAULT_RESPONSE_RESERVE_TOKENS,
})

/**
 * Single source of truth for model IDs, compaction, and point-in-time pricing.
 * Prices are USD per token for Cloudflare Workers AI DeepSeek V4.1 Flash as of
 * 2026-11-25: $0.30/M input, $1.20/M output, $0.006/M cached input.
 * https://developers.cloudflare.com/workers-ai/models/deepseek-v4.1-flash-1017/
 */
export const agentModelProfiles = {
  deepseekV41FlashWorkersAi: {
    contextWindowTokens: 1_048_576,
    docs: 'Cloudflare Workers AI model docs: @cf/deepseek-ai/deepseek-v4.1-flash-1017 context window is 1,048,576 tokens.',
    id: '@cf/deepseek-ai/deepseek-v4.1-flash-1017',
    maxOutputTokens: 16_000,
    provider: 'workers-ai',
    compaction: createPiStyleCompactionPolicy(1_048_576),
    pricePerToken: {
      input: 0.0000003,
      output: 0.0000012,
      cacheReadInput: 0.000000006,
    },
    reasoningEffort: 'high',
  },
} as const satisfies Record<string, AgentModelProfile>

export const DEFAULT_AGENT_MODEL_PROFILE =
  agentModelProfiles.deepseekV41FlashWorkersAi

export function getDefaultAgentModelProfile(): AgentModelProfile {
  return DEFAULT_AGENT_MODEL_PROFILE
}

const OPENAI_COMPATIBLE_DEFAULT_BASE_URL = 'http://localhost:11434/v1'
const OPENAI_COMPATIBLE_DEFAULT_MODEL_ID = 'qwen3:8b'
const OPENAI_COMPATIBLE_DEFAULT_CONTEXT_WINDOW_TOKENS = 32_768

/**
 * Resolves the active model profile from the runtime env.
 *
 * Behavior before this change: the Workers AI profile was the only option and
 * every call site got it implicitly. Now: `GARDEN_MODEL_PROVIDER` picks the
 * provider explicitly, and when unset, `GARDEN_OFFLINE=1` (set by
 * `pnpm dev:offline`) defaults to `openai-compatible`; everything else keeps
 * the Workers AI default, byte-identical to before.
 *
 * The openai-compatible profile clamps the pi-style compaction policy
 * proportionally (`reserve = min(16384, window/8)`, `tail = min(20000,
 * window/4)`): the fixed 16,384-token response reserve assumes a large hosted
 * window and would produce a non-positive compaction threshold for local models with
 * ≤16k contexts. Pricing is zero — local/self-hosted calls have no per-token
 * cost, and PostHog cost overrides read these fields.
 */
export function resolveAgentModelProfile(
  env?: AgentModelEnv,
): AgentModelProfile {
  const requested = env?.GARDEN_MODEL_PROVIDER?.trim()
  // Empty string means "unset": the wrangler `vars` block declares these keys
  // with "" defaults so process env can override them in local dev (wrangler
  // only forwards declared keys). Any non-empty GARDEN_OFFLINE enables
  // offline mode.
  const offline = (env?.GARDEN_OFFLINE ?? '').trim() !== ''
  const provider: AgentModelProvider =
    requested === 'openai-compatible' || requested === 'workers-ai'
      ? requested
      : offline
        ? 'openai-compatible'
        : 'workers-ai'
  if (provider === 'workers-ai') return DEFAULT_AGENT_MODEL_PROFILE

  const parsedWindow = Number.parseInt(
    env?.GARDEN_MODEL_CONTEXT_WINDOW_TOKENS ?? '',
    10,
  )
  const contextWindowTokens =
    Number.isFinite(parsedWindow) && parsedWindow > 0
      ? parsedWindow
      : OPENAI_COMPATIBLE_DEFAULT_CONTEXT_WINDOW_TOKENS
  const responseReserveTokens = Math.min(
    PI_DEFAULT_RESPONSE_RESERVE_TOKENS,
    Math.floor(contextWindowTokens / 8),
  )
  return {
    contextWindowTokens,
    docs: 'Local/OpenAI-compatible model configured via GARDEN_MODEL_* env; context window from GARDEN_MODEL_CONTEXT_WINDOW_TOKENS.',
    id: env?.GARDEN_MODEL_ID?.trim() || OPENAI_COMPATIBLE_DEFAULT_MODEL_ID,
    maxOutputTokens: DEFAULT_AGENT_MODEL_PROFILE.maxOutputTokens,
    provider: 'openai-compatible',
    compaction: {
      responseReserveTokens,
      tailTokenBudgetTokens: Math.min(
        PI_DEFAULT_COMPACTION_TAIL_TOKENS,
        Math.floor(contextWindowTokens / 4),
      ),
      thresholdTokens: contextWindowTokens - responseReserveTokens,
    },
    pricePerToken: { input: 0, output: 0, cacheReadInput: 0 },
  }
}

/**
 * Creates Garden's agent model. The provider comes from the resolved profile:
 * Cloudflare Workers AI by default, or any OpenAI-compatible endpoint when
 * offline mode / GARDEN_MODEL_* env selects it (see resolveAgentModelProfile).
 * When a Think turn supplies tracing identity, PostHog's official AI SDK 6
 * wrapper captures generations, streaming output, tools, usage, latency, and
 * provider failures — on both provider branches. The wrapper uses queued
 * capture with the edge client's Cloudflare scheduler, keeping PostHog network
 * work off the model stream's completion path.
 */
export function createAgentModel(config: AgentModelConfig): LanguageModel {
  const profile = config.profile ?? resolveAgentModelProfile(config.env)
  const model =
    profile.provider === 'openai-compatible'
      ? createOpenAICompatibleAgentModel(profile, config.env)
      : createWorkersAiAgentModel(profile, config)
  const token = config.env?.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim()
  if (!token || !config.tracing) return model

  const posthog = new PostHog(token, {
    host: config.env?.VITE_PUBLIC_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST,
    ...(config.tracing.privacyMode
      ? {
          enableExceptionAutocapture: false,
          before_send: (event) => {
            if (!event || event.event === '$exception') return null
            return {
              ...event,
              properties: {
                ...Object.fromEntries(
                  Object.entries(event.properties ?? {}).filter(([key]) =>
                    generationMetadataKeys.has(key),
                  ),
                ),
                $ai_error: event.properties?.$ai_is_error
                  ? 'Agent model request failed.'
                  : undefined,
              },
            }
          },
        }
      : {}),
    flushAt: 1,
    flushInterval: 0,
    waitUntil: config.tracing.waitUntil,
    waitUntilDebounceMs: 0,
  })

  const properties = {
    environment: resolveGardenAnalyticsEnvironment({
      environment: config.env?.ENVIRONMENT,
    }),
    workspace_id: config.tracing.workspaceId,
    ...config.tracing.properties,
  }
  const provider =
    profile.provider === 'openai-compatible'
      ? 'openai-compatible.chat'
      : 'workersai.chat'
  const costs = {
    inputCost: profile.pricePerToken.input,
    outputCost: profile.pricePerToken.output,
  }
  if (model.specificationVersion === 'v4') {
    return traceV4Model(
      model,
      posthog,
      {
        distinctId: config.tracing.distinctId,
        traceId: config.tracing.traceId,
        groups: { workspace: config.tracing.workspaceId },
        properties,
        privacyMode: config.tracing.privacyMode ?? false,
        model: profile.id,
        provider,
        costOverride: costs,
      },
      config.tracing.waitUntil,
    )
  }

  return withTracing(model, posthog, {
    posthogDistinctId: config.tracing.distinctId,
    posthogTraceId: config.tracing.traceId,
    posthogGroups: { workspace: config.tracing.workspaceId },
    posthogProperties: properties,
    posthogPrivacyMode: config.tracing.privacyMode ?? false,
    posthogCaptureImmediate: false,
    posthogModelOverride: profile.id,
    posthogProviderOverride: provider,
    posthogCostOverride: costs,
  })
}

/** Workers AI factory for profiles served through the `AI` binding. */
function createWorkersAiAgentModel(
  profile: AgentModelProfile,
  config: AgentModelConfig,
) {
  const gatewayId = config.gatewayId?.trim()
  const workersai = createWorkersAI({
    binding: config.ai,
    ...(gatewayId ? { gateway: { id: gatewayId } } : {}),
  })
  const model = workersai(profile.id, {
    reasoning_effort: profile.reasoningEffort,
  })
  return config.onModelRetired
    ? observeRetiredAgentModel(model, config.onModelRetired)
    : model
}

/**
 * OpenAI-compatible factory for offline/local dev: points the AI SDK at any
 * OpenAI-compatible endpoint (Ollama default, or OpenRouter/Groq/etc via
 * GARDEN_MODEL_BASE_URL + GARDEN_MODEL_API_KEY). Never touches the Workers AI
 * binding, which throws when invoked with remote bindings disabled.
 */
function createOpenAICompatibleAgentModel(
  profile: AgentModelProfile,
  env?: AgentModelEnv,
) {
  const apiKey = env?.GARDEN_MODEL_API_KEY?.trim()
  const provider = createOpenAICompatible({
    name: 'garden-openai-compatible',
    baseURL:
      env?.GARDEN_MODEL_BASE_URL?.trim() || OPENAI_COMPATIBLE_DEFAULT_BASE_URL,
    ...(apiKey ? { apiKey } : {}),
    includeUsage: true,
  })
  return provider(profile.id)
}
