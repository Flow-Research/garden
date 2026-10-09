import {
  authorizeBrainRunTool,
  type BrainRunOrigin,
} from './brain-run-authority'
import {
  Session,
  Think,
  type TurnConfig,
  type TurnContext,
} from '@cloudflare/think'
import type { LanguageModel, ToolSet, UIMessage } from 'ai'
import { Effect, Schema } from 'effect'
import { createAgentModel } from './model'
import { configureThinkCompaction } from './think-compaction'
import {
  BRAIN_WRITE_BACK_SYSTEM_PROMPT,
  BRAIN_WRITE_BACK_TOOL_NAMES,
  brainWriteBackToolContext,
  createBrainWriteBackMessage,
  createBrainWriteBackTools,
  type BrainWriteBackRunInput,
} from './brain-write-back'

type AgentRuntimeEnv = Cloudflare.Env & {
  AI: Ai
  AI_GATEWAY_ID?: string
  ENVIRONMENT?: string
  BRAIN_FILES: R2Bucket
  FILES: R2Bucket
  HYPERDRIVE: Hyperdrive
  HELIX_URL?: string
  HELIX_API_KEY?: string
  VITE_PUBLIC_POSTHOG_HOST?: string
  VITE_PUBLIC_POSTHOG_PROJECT_TOKEN?: string
}

type BrainWriteBackConfig = ReturnType<typeof brainWriteBackToolContext> & {
  origin: BrainRunOrigin
}

const THINK_TURN_MAX_RETRIES = 1
const THINK_TURN_TELEMETRY_FUNCTION_ID = 'garden.brain-write-back.turn'

class BrainWriteBackTurnError extends Schema.TaggedError<BrainWriteBackTurnError>()(
  'BrainWriteBackTurnError',
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/**
 * Runs one bounded write-back pass over a finished run summary. Mirrors
 * BrainAuditSubAgent: only the Brain tools are active, the turn is programmatic,
 * and the facet is reclaimed after the result is terminal.
 */
export class BrainWriteBackSubAgent extends Think<AgentRuntimeEnv> {
  maxSteps = 20

  getModel(): LanguageModel {
    return createAgentModel({
      ai: this.env.AI,
      env: this.env,
      gatewayId: this.env.AI_GATEWAY_ID,
    })
  }

  override async configureSession(session: Session) {
    return configureThinkCompaction(session, this.getModel())
      .withContext('brain-write-back', {
        description: 'Run memory write-back contract.',
        provider: { get: async () => BRAIN_WRITE_BACK_SYSTEM_PROMPT },
      })
      .withCachedPrompt()
  }

  override getSkills() {
    return []
  }

  override getTools(): ToolSet {
    return createBrainWriteBackTools({
      env: {
        ...(this.env.HELIX_URL === undefined
          ? {}
          : { HELIX_URL: this.env.HELIX_URL }),
        ...(this.env.HELIX_API_KEY === undefined
          ? {}
          : { HELIX_API_KEY: this.env.HELIX_API_KEY }),
      },
      ai: this.env.AI,
      files: this.env.BRAIN_FILES,
      databaseUrl: this.env.HYPERDRIVE.connectionString,
      getContext: async (toolName = 'brain_search') => {
        const config = this.getConfig<BrainWriteBackConfig>()
        if (!config?.origin) return null
        return (
          await authorizeBrainRunTool(
            this.env.HYPERDRIVE.connectionString,
            config.origin,
            toolName,
          )
        ).match({
          ok: (context) => ({ ...context, runId: config.runId }),
          err: () => null,
        })
      },
    })
  }

  override async beforeTurn(_ctx: TurnContext): Promise<TurnConfig> {
    const config = this.getConfig<BrainWriteBackConfig>()
    if (!config?.origin)
      throw new BrainWriteBackTurnError({
        operation: 'authorize write-back',
        message: 'Brain run authority is unavailable.',
      })
    const authority = await authorizeBrainRunTool(
      this.env.HYPERDRIVE.connectionString,
      config.origin,
      'add_to_brain',
    )
    if (authority.isErr()) throw authority.error
    // The summary can contain retrieved Brain content and proposals perform a
    // dedupe read. Both grants must remain valid before another model sees it.
    const readAuthority = await authorizeBrainRunTool(
      this.env.HYPERDRIVE.connectionString,
      config.origin,
      'brain_search',
    )
    if (readAuthority.isErr()) throw readAuthority.error
    return Effect.runPromise(
      Effect.suspend(() => {
        const config = this.getConfig<BrainWriteBackConfig>()
        if (config === null) {
          return Effect.fail(
            new BrainWriteBackTurnError({
              operation: 'configure write-back turn',
              message: 'Brain write-back context is missing.',
            }),
          )
        }

        return Effect.succeed({
          model: this.getModel(),
          experimental_telemetry: {
            functionId: THINK_TURN_TELEMETRY_FUNCTION_ID,
            isEnabled: true,
            metadata: {
              agentClass: 'BrainWriteBackSubAgent',
              runId: config.runId,
            },
            recordInputs: false,
            recordOutputs: false,
          },
          activeTools: [...BRAIN_WRITE_BACK_TOOL_NAMES],
          maxRetries: THINK_TURN_MAX_RETRIES,
          maxSteps: this.maxSteps,
          sendReasoning: true,
        } satisfies TurnConfig)
      }),
    )
  }

  async runWriteBack(
    input: BrainWriteBackRunInput,
  ): Promise<{ status: 'completed' }> {
    return Effect.runPromise(
      Effect.sync(() => {
        this.configure<BrainWriteBackConfig>({
          ...brainWriteBackToolContext(input),
          origin: {
            runtimeName: this.parentPath.at(-1)?.name ?? '',
            objectId: input.originObjectId,
            runId: input.runId,
            runKind: input.runKind,
            agentId: input.agentId,
            workspaceId: input.workspaceId,
            ownerUserId: input.ownerUserId,
          },
          ...(input.runKind === 'issue'
            ? { readAudience: 'org' as const }
            : {}),
        })
        const message: UIMessage = {
          id: `brain-write-back:${input.runKind}:${input.runId}:summary`,
          role: 'user',
          parts: [{ type: 'text', text: createBrainWriteBackMessage(input) }],
        }
        return message
      }).pipe(
        Effect.andThen((message) =>
          Effect.tryPromise({
            try: () => this.saveMessages([message]),
            catch: (cause) =>
              new BrainWriteBackTurnError({
                operation: 'save write-back messages',
                message: 'Brain write-back turn failed.',
                cause,
              }),
          }),
        ),
        Effect.flatMap((result) => {
          if (result.status === 'completed') {
            return Effect.succeed({ status: 'completed' as const })
          }
          return Effect.fail(
            new BrainWriteBackTurnError({
              operation: 'complete write-back turn',
              message: `Brain write-back turn ${result.status}${result.error ? `: ${result.error}` : ''}`,
            }),
          )
        }),
      ),
    )
  }
}
