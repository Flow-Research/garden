import type { LanguageModel } from 'ai'
import { withTracing } from '@posthog/ai/vercel'
import { PostHog } from 'posthog-node'
import { createWorkersAI } from 'workers-ai-provider'
import { resolveGardenAnalyticsEnvironment } from '@garden/observability/analytics/events'

const DEFAULT_AI_GATEWAY_ID = 'garden-staging'
const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com'

export type AgentModelProvider = 'workers-ai'

export type AgentModelCompactionPolicy = {
  responseReserveTokens: number
  tailTokenBudgetTokens: number
  thresholdTokens: number
}

export type AgentModelProfile = {
  contextWindowTokens: number
  docs: string
  id: string
  provider: AgentModelProvider
  compaction: AgentModelCompactionPolicy
  pricePerToken: {
    cacheReadInput: number
    input: number
    output: number
  }
}

export type AgentModelTracing = {
  distinctId: string
  traceId: string
  workspaceId: string
  properties: Record<string, unknown>
  waitUntil: (promise: Promise<unknown>) => void
}

type AgentModelConfig = {
  ai: Ai
  env?: {
    ENVIRONMENT?: string
    VITE_PUBLIC_POSTHOG_HOST?: string
    VITE_PUBLIC_POSTHOG_PROJECT_TOKEN?: string
  }
  gatewayId?: string
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
 * Prices are USD per token for Cloudflare Workers AI Kimi K2.7 Code as of
 * 2026-07-19: $0.95/M input, $4/M output, $0.19/M cached input.
 */
export const agentModelProfiles = {
  kimiK27CodeWorkersAi: {
    contextWindowTokens: 262_144,
    docs: 'Cloudflare Workers AI model docs: @cf/moonshotai/kimi-k2.7-code context window is 262,144 tokens.',
    id: '@cf/moonshotai/kimi-k2.7-code',
    provider: 'workers-ai',
    compaction: createPiStyleCompactionPolicy(262_144),
    pricePerToken: {
      input: 0.00000095,
      output: 0.000004,
      cacheReadInput: 0.00000019,
    },
  },
} as const satisfies Record<string, AgentModelProfile>

export const DEFAULT_AGENT_MODEL_PROFILE =
  agentModelProfiles.kimiK27CodeWorkersAi

export function getDefaultAgentModelProfile(): AgentModelProfile {
  return DEFAULT_AGENT_MODEL_PROFILE
}

/**
 * Creates Garden's Cloudflare Workers AI model. When a Think turn supplies
 * tracing identity, PostHog's official AI SDK 6 wrapper captures generations,
 * streaming output, tools, usage, latency, and provider failures. The wrapper
 * uses queued capture with the edge client's Cloudflare scheduler, keeping
 * PostHog network work off the model stream's completion path.
 */
export function createAgentModel(config: AgentModelConfig): LanguageModel {
  const profile = config.profile ?? DEFAULT_AGENT_MODEL_PROFILE
  const workersai = createWorkersAI({
    binding: config.ai,
    gateway: { id: config.gatewayId ?? DEFAULT_AI_GATEWAY_ID },
  })
  const model = workersai(profile.id)
  const token = config.env?.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim()
  if (!token || !config.tracing) return model

  const posthog = new PostHog(token, {
    host: config.env?.VITE_PUBLIC_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST,
    flushAt: 1,
    flushInterval: 0,
    waitUntil: config.tracing.waitUntil,
    waitUntilDebounceMs: 0,
  })

  return withTracing(model, posthog, {
    posthogDistinctId: config.tracing.distinctId,
    posthogTraceId: config.tracing.traceId,
    posthogGroups: { workspace: config.tracing.workspaceId },
    posthogProperties: {
      environment: resolveGardenAnalyticsEnvironment({
        environment: config.env?.ENVIRONMENT,
      }),
      workspace_id: config.tracing.workspaceId,
      ...config.tracing.properties,
    },
    posthogPrivacyMode: false,
    posthogCaptureImmediate: false,
    posthogModelOverride: profile.id,
    posthogProviderOverride: 'workersai.chat',
    posthogCostOverride: {
      inputCost: profile.pricePerToken.input,
      outputCost: profile.pricePerToken.output,
    },
  })
}
