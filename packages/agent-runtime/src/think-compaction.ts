import {
  defaultContextOverflowClassifier,
  type ContextOverflowConfig,
  type Session,
} from '@cloudflare/think'
import { createCompactFunction } from 'agents/experimental/memory/utils'
import { generateText, type LanguageModel } from 'ai'
import { getDefaultAgentModelProfile, type AgentModelProfile } from './model'

/**
 * Wires Think's built-in compaction to Garden sessions using the active model
 * profile. The policy follows pi's documented shape: compact at model-window
 * minus response reserve, and keep a recent tail verbatim. The compaction
 * algorithm itself comes from the Agents SDK helper, so tool-pair boundary
 * handling and iterative summaries stay SDK-owned. Sources: pi
 * `docs/compaction.md`, Cloudflare Think context-overflow docs, and
 * `agents/experimental/memory`.
 */
export function configureThinkCompaction(
  session: Session,
  model: LanguageModel,
  profile: AgentModelProfile = getDefaultAgentModelProfile(),
) {
  return session
    .onCompaction(
      createCompactFunction({
        tailTokenBudget: profile.compaction.tailTokenBudgetTokens,
        summarize: async (prompt) => {
          const result = await generateText({
            model,
            prompt,
          })
          return result.text
        },
      }),
    )
    .compactAfter(profile.compaction.thresholdTokens)
    .onCompactionError((error) => {
      console.warn('[agent-runtime] Think session compaction failed', {
        error: error instanceof Error ? error.message : String(error),
        modelId: profile.id,
      })
    })
}

/**
 * Builds Think context-overflow recovery config from the model profile rather
 * than hard-coded agent values. `headroom: 1` is intentional: pi-style response
 * reserve is already represented in `thresholdTokens`, so Think's proactive
 * guard should compare against that exact threshold instead of applying a
 * second fractional reserve.
 */
export function createGardenContextOverflow(
  profile: AgentModelProfile = getDefaultAgentModelProfile(),
): ContextOverflowConfig {
  return {
    reactive: true,
    proactive: {
      headroom: 1,
      maxInputTokens: profile.compaction.thresholdTokens,
    },
  }
}

export const classifyGardenContextOverflow = defaultContextOverflowClassifier
