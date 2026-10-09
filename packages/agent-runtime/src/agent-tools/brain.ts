import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { Context, Effect, Layer, Schema } from 'effect'
import { ItemId, Kind, WorkspaceId } from '@garden/brain/domain'
import { orgScope, userScope } from '@garden/brain/domain/scope'
import { Brain } from '@garden/brain/services/brain'
import type { BrainShape } from '@garden/brain/services/brain'
import { makeWorkerBrainLive } from '@garden/brain/services/worker'
import type { WorkersAiBinding } from '@garden/brain/services/embeddings'
import type { R2BucketLike } from '@garden/brain/services/raw-file-store'

export type BrainToolContext = {
  readonly workspaceId: string
  readonly agentId: string
  readonly runId: string
  readonly userId?: string
  /** Shared outputs may read only org knowledge; userId still identifies the author. */
  readonly readAudience?: 'org'
}

export type BrainToolOperations = Pick<
  BrainShape,
  | 'ensureIndexes'
  | 'search'
  | 'read'
  | 'addText'
  | 'updateItemMetadata'
  | 'observeMention'
  | 'linkItems'
  | 'neighborhood'
>

const MAX_SEARCH_K = 8
const MAX_HIT_BODY_CHARS = 4_000

const brainSearchInputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .describe('What to find in the workspace brain.'),
    k: z
      .number()
      .int()
      .min(1)
      .max(MAX_SEARCH_K)
      .optional()
      .describe(`How many results to return (default 5, max ${MAX_SEARCH_K}).`),
  })
  .strict()

const addToBrainInputSchema = z
  .object({
    mode: z
      .enum(['create', 'update'])
      .describe(
        'create a new note from label and content, or update an existing item kind and summary.',
      ),
    itemId: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Existing brain item id. Required when mode is "update".'),
    label: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Short name for a new item. Required when mode is "create".'),
    content: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'The knowledge to persist, in the agent’s own words. Required when mode is "create".',
      ),
    kind: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Free-text kind you invent, e.g. "decision", "person", or "policy". Required when mode is "update".',
      ),
    summary: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'One-line summary. Optional on create, required when mode is "update".',
      ),
    scope: z
      .enum(['org', 'user'])
      .optional()
      .describe(
        'Who this knowledge belongs to. Use "user" for facts about a person or their preferences; everything else stays "org".',
      ),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === 'update') {
      for (const field of ['itemId', 'kind', 'summary'] as const) {
        if (value[field] === undefined) {
          ctx.addIssue({
            code: 'custom',
            message: `mode "update" requires ${field}.`,
          })
        }
      }
      return
    }
    for (const field of ['label', 'content'] as const) {
      if (value[field] === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: `mode "create" requires ${field}.`,
        })
      }
    }
  })

const brainObserveMentionInputSchema = z
  .object({
    itemId: z
      .string()
      .trim()
      .min(1)
      .describe('Source brain item where this exact mention was observed.'),
    text: z
      .string()
      .trim()
      .min(1)
      .describe('Exact mention string copied from the source.'),
    span: z
      .object({
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
      })
      .strict()
      .refine((span) => span.end >= span.start, {
        message: 'Mention span end must be greater than or equal to start.',
      })
      .optional()
      .describe('Optional zero-based source character range.'),
  })
  .strict()

const brainLinkInputSchema = z
  .object({
    from: z.string().trim().min(1).describe('Source brain item id.'),
    to: z.string().trim().min(1).describe('Target brain item id.'),
    edge: z
      .string()
      .trim()
      .min(1)
      .describe(
        'Free-text relationship label, e.g. "DECIDED_BY", "MENTIONS", or "SAME_AS".',
      ),
  })
  .strict()

const brainNeighborhoodInputSchema = z
  .object({
    itemId: z.string().trim().min(1).describe('Brain item to explore.'),
    depth: z
      .number()
      .int()
      .min(1)
      .max(2)
      .optional()
      .describe('Fixed traversal depth (default 1, max 2).'),
  })
  .strict()

const toHit = (raw: {
  item: {
    id: string
    label: string
    kind: string
    summary?: string
    body?: string
  }
  score: number
  cite?: string
}) => ({
  id: raw.item.id,
  label: raw.item.label,
  kind: raw.item.kind,
  ...(raw.item.summary === undefined ? {} : { summary: raw.item.summary }),
  ...(raw.item.body === undefined
    ? {}
    : { body: raw.item.body.slice(0, MAX_HIT_BODY_CHARS) }),
  score: raw.score,
  ...(raw.cite === undefined ? {} : { cite: raw.cite }),
})

const toNeighborhoodItem = (item: {
  id: string
  label: string
  kind: string
  summary?: string
  body?: string
}) => ({
  id: item.id,
  label: item.label,
  kind: item.kind,
  ...(item.summary === undefined ? {} : { summary: item.summary }),
  ...(item.body === undefined
    ? {}
    : { body: item.body.slice(0, MAX_HIT_BODY_CHARS) }),
})

const toNeighborhoodEdge = (edge: {
  id: string
  from: string
  to: string
  edge: string
  mention?: {
    text: string
    span?: { readonly start: number; readonly end: number }
  }
}) => ({
  id: edge.id,
  from: edge.from,
  to: edge.to,
  edge: edge.edge,
  ...(edge.mention === undefined
    ? {}
    : {
        mention: {
          text: edge.mention.text,
          ...(edge.mention.span === undefined
            ? {}
            : { span: edge.mention.span }),
        },
      }),
})

export type BrainToolDependencies = {
  env: { HELIX_URL?: string; HELIX_API_KEY?: string }
  ai: WorkersAiBinding
  files: R2BucketLike
  getContext: (
    toolName: string,
  ) => BrainToolContext | null | Promise<BrainToolContext | null>
  brain?: BrainToolOperations
}

type BrainToolOutput = Record<string, unknown>
type SearchInput = { readonly query: string; readonly k: number }
type AddInput = z.infer<typeof addToBrainInputSchema>
type ObserveMentionInput = z.infer<typeof brainObserveMentionInputSchema>
type LinkInput = z.infer<typeof brainLinkInputSchema>
type NeighborhoodInput = z.infer<typeof brainNeighborhoodInputSchema>

class BrainToolContextError extends Schema.TaggedError<BrainToolContextError>()(
  'BrainToolContextError',
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

class BrainToolsUnavailableError extends Schema.TaggedError<BrainToolsUnavailableError>()(
  'BrainToolsUnavailableError',
  { message: Schema.String },
) {}

class BrainToolInputError extends Schema.TaggedError<BrainToolInputError>()(
  'BrainToolInputError',
  { message: Schema.String },
) {}

interface BrainToolsServiceShape {
  readonly search: (input: SearchInput) => Effect.Effect<BrainToolOutput>
  readonly add: (input: AddInput) => Effect.Effect<BrainToolOutput>
  readonly observeMention: (
    input: ObserveMentionInput,
  ) => Effect.Effect<BrainToolOutput>
  readonly link: (input: LinkInput) => Effect.Effect<BrainToolOutput>
  readonly neighborhood: (
    input: NeighborhoodInput,
  ) => Effect.Effect<BrainToolOutput>
}

class BrainToolsService extends Context.Service<
  BrainToolsService,
  BrainToolsServiceShape
>()('@garden/agent-runtime/BrainToolsService') {}

const unavailableMessage =
  'The workspace brain is not configured (missing HELIX_URL).'
const missingContextMessage =
  'No active run context; the brain tools need a workspace and agent.'

const messageFromUnknown = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

const actorFrom = (ctx: BrainToolContext) => ({
  _tag: 'Agent' as const,
  agentId: ctx.agentId,
  runId: ctx.runId,
})

/** Maps Effect failures into stable tool payloads; missing authority stays explicit. */
const toolOutcome = <A, E>(
  code: string,
  effect: Effect.Effect<A, E>,
  onSuccess: (value: A) => BrainToolOutput,
): Effect.Effect<BrainToolOutput> =>
  Effect.match(effect, {
    onFailure: (failure) => {
      if (failure instanceof BrainToolsUnavailableError) {
        return { ok: false, error: failure.message }
      }
      if (failure instanceof BrainToolInputError) {
        return { ok: false, error: failure.message }
      }
      if (
        failure instanceof BrainToolContextError &&
        failure.cause === undefined
      ) {
        return { ok: false, error: failure.message }
      }
      return {
        ok: false,
        error: code,
        message: messageFromUnknown(failure),
      }
    },
    onSuccess,
  })

/** Builds Effect-owned Brain tool workflows over one injected or live Brain service. */
const makeBrainToolsService = (
  deps: BrainToolDependencies,
  brain: BrainToolOperations | null,
): BrainToolsServiceShape => {
  const resolveContext = Effect.fn('BrainTools.resolveContext')(function* (
    toolName: string,
  ) {
    const ctx = yield* Effect.tryPromise({
      try: async () => await deps.getContext(toolName),
      catch: (cause) =>
        new BrainToolContextError({
          message: 'Failed to resolve the active brain tool context.',
          cause,
        }),
    })
    if (ctx === null) {
      return yield* new BrainToolContextError({
        message: missingContextMessage,
      })
    }
    return ctx
  })

  const requireBrain = Effect.fn('BrainTools.requireBrain')(function* () {
    if (brain === null) {
      return yield* new BrainToolsUnavailableError({
        message: unavailableMessage,
      })
    }
    return brain
  })

  const search = Effect.fn('BrainTools.search')(function* (input: SearchInput) {
    const ctx = yield* resolveContext('brain_search')
    const service = yield* requireBrain()
    yield* service.ensureIndexes()
    return yield* service.search({
      tenantId: WorkspaceId.make(ctx.workspaceId),
      query: input.query,
      k: input.k,
      viewer: {
        teamIds: new Set<string>(),
        userId: ctx.readAudience === 'org' ? undefined : ctx.userId,
      },
    })
  })

  /** Authorizes target visibility before a mutation can reveal metadata. */
  const requireVisibleTarget = Effect.fn('BrainTools.requireVisibleTarget')(
    function* (
      ctx: BrainToolContext,
      service: BrainToolOperations,
      itemId: string,
    ) {
      const item = yield* service.read(
        ItemId.make(itemId),
        WorkspaceId.make(ctx.workspaceId),
        {
          teamIds: new Set<string>(),
          userId: ctx.readAudience === 'org' ? undefined : ctx.userId,
        },
      )
      if (item === null) {
        return yield* new BrainToolInputError({
          message: 'The Brain item is unavailable for this run.',
        })
      }
    },
  )

  const add = Effect.fn('BrainTools.add')(function* (input: AddInput) {
    const ctx = yield* resolveContext('add_to_brain')
    const service = yield* requireBrain()
    if (input.mode === 'update') {
      if (
        input.itemId === undefined ||
        input.kind === undefined ||
        input.summary === undefined
      ) {
        return yield* new BrainToolInputError({
          message: 'mode "update" needs itemId, kind, and summary.',
        })
      }
      yield* requireVisibleTarget(ctx, service, input.itemId)
      yield* resolveContext('add_to_brain')
      return yield* service.updateItemMetadata({
        tenantId: WorkspaceId.make(ctx.workspaceId),
        itemId: ItemId.make(input.itemId),
        kind: Kind.make(input.kind),
        summary: input.summary,
      })
    }
    if (input.label === undefined || input.content === undefined) {
      return yield* new BrainToolInputError({
        message: 'mode "create" needs label and content.',
      })
    }
    if (input.scope === 'user' && ctx.userId === undefined) {
      return yield* new BrainToolInputError({
        message: 'scope "user" needs a user context.',
      })
    }
    const scope =
      input.scope === 'user' && ctx.userId !== undefined
        ? userScope(ctx.userId)
        : orgScope()
    yield* service.ensureIndexes()
    yield* resolveContext('add_to_brain')
    return yield* service.addText({
      tenantId: WorkspaceId.make(ctx.workspaceId),
      label: input.label,
      body: input.content,
      ...(input.kind === undefined ? {} : { kind: Kind.make(input.kind) }),
      ...(input.summary === undefined ? {} : { summary: input.summary }),
      scope,
      actor: actorFrom(ctx),
    })
  })

  const observeMention = Effect.fn('BrainTools.observeMention')(function* (
    input: ObserveMentionInput,
  ) {
    const ctx = yield* resolveContext('brain_observe_mention')
    const service = yield* requireBrain()
    yield* requireVisibleTarget(ctx, service, input.itemId)
    yield* resolveContext('brain_observe_mention')
    return yield* service.observeMention({
      tenantId: WorkspaceId.make(ctx.workspaceId),
      itemId: ItemId.make(input.itemId),
      text: input.text,
      ...(input.span === undefined ? {} : { span: input.span }),
      actor: actorFrom(ctx),
    })
  })

  const link = Effect.fn('BrainTools.link')(function* (input: LinkInput) {
    const ctx = yield* resolveContext('brain_link')
    const service = yield* requireBrain()
    yield* requireVisibleTarget(ctx, service, input.from)
    yield* requireVisibleTarget(ctx, service, input.to)
    yield* resolveContext('brain_link')
    return yield* service.linkItems({
      tenantId: WorkspaceId.make(ctx.workspaceId),
      from: ItemId.make(input.from),
      to: ItemId.make(input.to),
      edge: input.edge,
      actor: actorFrom(ctx),
    })
  })

  const neighborhood = Effect.fn('BrainTools.neighborhood')(function* (
    input: NeighborhoodInput,
  ) {
    const ctx = yield* resolveContext('brain_neighborhood')
    const service = yield* requireBrain()
    return yield* service.neighborhood({
      tenantId: WorkspaceId.make(ctx.workspaceId),
      itemId: ItemId.make(input.itemId),
      ...(input.depth === undefined ? {} : { depth: input.depth }),
      viewer: {
        teamIds: new Set<string>(),
        userId: ctx.readAudience === 'org' ? undefined : ctx.userId,
      },
    })
  })

  return BrainToolsService.of({
    search: (input) =>
      toolOutcome('brain_search_failed', search(input), (hits) => ({
        ok: true,
        hits: hits.map(toHit),
      })),
    add: (input) =>
      toolOutcome('add_to_brain_failed', add(input), (item) => ({
        ok: true,
        id: item.id,
        label: item.label,
        kind: item.kind,
        indexed: item.indexed,
      })),
    observeMention: (input) =>
      toolOutcome(
        'brain_observe_mention_failed',
        observeMention(input),
        (observation) => ({
          ok: true,
          itemId: observation.itemId,
          text: observation.text,
          ...(observation.span === undefined ? {} : { span: observation.span }),
        }),
      ),
    link: (input) =>
      toolOutcome('brain_link_failed', link(input), (value) => ({
        ok: true,
        ...value,
      })),
    neighborhood: (input) =>
      toolOutcome(
        'brain_neighborhood_failed',
        neighborhood(input),
        (value) => ({
          ok: true,
          items: value.items.map(toNeighborhoodItem),
          edges: value.edges.map(toNeighborhoodEdge),
        }),
      ),
  })
}

/** Provides the Brain tool service for one Effect-backed tool execution. */
const makeBrainToolsLayer = (
  deps: BrainToolDependencies,
): Layer.Layer<BrainToolsService> => {
  if (deps.brain !== undefined) {
    return Layer.succeed(
      BrainToolsService,
      makeBrainToolsService(deps, deps.brain),
    )
  }
  if (deps.env.HELIX_URL === undefined) {
    return Layer.succeed(BrainToolsService, makeBrainToolsService(deps, null))
  }
  const brainLayer = makeWorkerBrainLive({
    baseUrl: deps.env.HELIX_URL,
    apiKey: deps.env.HELIX_API_KEY,
    ai: deps.ai,
    files: deps.files,
  })
  return Layer.effect(
    BrainToolsService,
    Effect.map(Brain, (brain) => makeBrainToolsService(deps, brain)),
  ).pipe(Layer.provide(brainLayer))
}

/**
 * Exposes Brain as five Effect-backed structured operations. Agents receive
 * product outcomes only; Helix DSL and infrastructure failures remain behind
 * the service layer, with Promise conversion limited to AI SDK callbacks.
 */
export function createBrainTools(deps: BrainToolDependencies): ToolSet {
  const layer = makeBrainToolsLayer(deps)
  const runService = (
    operation: (
      service: BrainToolsServiceShape,
    ) => Effect.Effect<BrainToolOutput>,
  ): Promise<BrainToolOutput> =>
    Effect.runPromise(
      Effect.flatMap(BrainToolsService, operation).pipe(Effect.provide(layer)),
    )

  return {
    brain_search: tool({
      description:
        'Search the workspace’s Org Brain: indexed files, notes, decisions, and agent-written knowledge. Returns scored, cited hits scoped to this workspace. Use it to recall what the workspace already knows before re-deriving or re-searching the web.',
      inputSchema: brainSearchInputSchema,
      execute: (input) =>
        runService((service) =>
          service.search({ query: input.query, k: input.k ?? 5 }),
        ),
    }),

    add_to_brain: tool({
      description:
        'Persist durable knowledge in the workspace’s Org Brain. Use mode "create" with label and content to add a note, or mode "update" with itemId, kind, and summary to restructure an existing item. Kind is free text you choose, not an enum. Updates preserve body content and embeddings. Use scope "user" for facts about a person or their preferences; everything else stays "org".',
      inputSchema: addToBrainInputSchema,
      execute: (input) => runService((service) => service.add(input)),
    }),

    brain_observe_mention: tool({
      description:
        'Observe an exact person, company, or project name in a source item so later identity resolution can rerun without rereading the document.',
      inputSchema: brainObserveMentionInputSchema,
      execute: (input) =>
        runService((service) => service.observeMention(input)),
    }),

    brain_link: tool({
      description:
        'Invent relationship labels as the corpus demands; use SAME_AS only as a soft probable-duplicate link and never merge items.',
      inputSchema: brainLinkInputSchema,
      execute: (input) => runService((service) => service.link(input)),
    }),

    brain_neighborhood: tool({
      description:
        'Explore the agent-built graph in a bounded one- or two-hop view; item kinds and relationship labels are free text invented from the corpus.',
      inputSchema: brainNeighborhoodInputSchema,
      execute: (input) => runService((service) => service.neighborhood(input)),
    }),
  }
}
