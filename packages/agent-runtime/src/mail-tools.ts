import { derivePermissions } from '@garden/core/agents/permissions'
import {
  AgentId,
  ConversationId,
  MailboxId,
  WorkspaceId,
  type RequestDraftDeliveryInput,
} from '@garden/core/mail'
import type { GardenDatabase } from '@garden/db'
import { getPooledDb } from '@garden/db/runtime'
import { agent, chatThread } from '@garden/db/schema'
import {
  AgentCreateDraftInput,
  AgentListConversationsInput,
  AgentReadConversationInput,
  AgentRequestDraftDeliveryInput,
  AgentSaveDraftInput,
  MailAgentDeliveryDispatchError,
  MailAgentDeliveryDispatcher,
  MailAgentApplication,
  MailAgentPrincipal,
  mailDraftApplicationLayer,
  makeMailAgentApplicationLayer,
  makeMailRepositoryLayer,
  type MailAgentDeliveryDispatcherService,
  type MailAgentApplicationService,
} from '@garden/server/mail'
import { tool, type ToolSet } from 'ai'
import { and, eq, or } from 'drizzle-orm'
import { Effect, Layer, Result as EffectResult, Schema } from 'effect'

export interface MailAgentToolContext {
  readonly databaseUrl: string
  readonly threadId: string
  readonly dispatchDelivery: MailAgentDeliveryDispatcherService['dispatch']
  readonly getScope?: () => MailAgentToolScope | null
}

export interface MailAgentToolScope {
  readonly mailboxId: MailboxId
  readonly conversationId: ConversationId
}

export interface MailDeliveryWorkflowBinding {
  readonly create: (options: {
    readonly id: string
    readonly params: RequestDraftDeliveryInput
  }) => Promise<unknown>
  readonly get: (id: string) => Promise<unknown>
}

/** The owning chat facet cannot be resolved to one active Garden agent. */
export class MailAgentIdentityError extends Schema.TaggedErrorClass<MailAgentIdentityError>()(
  'MailAgentIdentityError',
  {
    runtimeKey: Schema.String,
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/** A mailbox-bound turn attempted to escape its server-selected conversation. */
export class MailAgentScopeError extends Schema.TaggedErrorClass<MailAgentScopeError>()(
  'MailAgentScopeError',
  {
    operation: Schema.String,
    message: Schema.String,
  },
) {}

/** Converts Effect Schema into AI SDK's validation plus JSON Schema contract. */
const aiInputSchema = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
) => Schema.toStandardJSONSchemaV1(Schema.toStandardSchemaV1(schema))

const ListMailboxesToolInput = aiInputSchema(Schema.Struct({}))
const ListConversationsToolInput = aiInputSchema(AgentListConversationsInput)
const ReadConversationToolInput = aiInputSchema(AgentReadConversationInput)
const CreateDraftToolInput = aiInputSchema(AgentCreateDraftInput)
const SaveDraftToolInput = aiInputSchema(AgentSaveDraftInput)
const RequestDraftDeliveryToolInput = aiInputSchema(
  AgentRequestDraftDeliveryInput,
)

/**
 * Adapts Cloudflare's create/get idempotency pattern to the Effect dispatch
 * port. Recovery only gets the same deterministic instance; it never creates a
 * second provider-send path.
 */
export const makeMailDeliveryWorkflowDispatcher = (
  binding: MailDeliveryWorkflowBinding,
): MailAgentDeliveryDispatcherService['dispatch'] =>
  Effect.fn('MailAgentTools.dispatchDelivery')(function* (params) {
    const workflowInstanceId = `mail-${params.draftId}-${params.expectedRevision}`
    yield* Effect.tryPromise({
      try: () => binding.create({ id: workflowInstanceId, params }),
      catch: (cause) =>
        new MailAgentDeliveryDispatchError({
          workflowInstanceId,
          operation: 'dispatchDelivery.create',
          message: 'Garden could not dispatch the mail delivery Workflow.',
          cause,
        }),
    }).pipe(
      Effect.catchTag('MailAgentDeliveryDispatchError', (createError) =>
        Effect.tryPromise({
          try: () => binding.get(workflowInstanceId),
          catch: () => createError,
        }),
      ),
    )
    return { workflowInstanceId }
  })

/** Resolves runtime-owned identity; model tool arguments never carry authority. */
export const resolveMailAgentPrincipal = Effect.fn(
  'MailAgentTools.resolvePrincipal',
)(function* (db: GardenDatabase, runtimeKey: string) {
  const rows = yield* Effect.tryPromise({
    try: () =>
      db
        .select({
          workspaceId: chatThread.workspaceId,
          agentId: chatThread.agentId,
          permissions: agent.permissions,
        })
        .from(chatThread)
        .innerJoin(
          agent,
          and(
            eq(agent.id, chatThread.agentId),
            eq(agent.workspaceId, chatThread.workspaceId),
          ),
        )
        .where(
          and(
            or(
              eq(chatThread.id, runtimeKey),
              eq(chatThread.runtimeKey, runtimeKey),
            ),
            eq(chatThread.runtimeKind, 'chat'),
            eq(agent.status, 'active'),
          ),
        )
        .limit(1),
    catch: (cause) =>
      new MailAgentIdentityError({
        runtimeKey,
        operation: 'resolvePrincipal.select',
        message: 'Garden could not resolve mail authority for this agent run.',
        cause,
      }),
  })
  const row = rows[0]
  if (row === undefined) {
    return yield* new MailAgentIdentityError({
      runtimeKey,
      operation: 'resolvePrincipal',
      message: 'Active chat agent identity was not found.',
    })
  }
  const permissions = derivePermissions({
    agent: { permissions: row.permissions },
  })
  return yield* Schema.decodeUnknownEffect(MailAgentPrincipal)({
    workspaceId: WorkspaceId.make(row.workspaceId),
    agentId: AgentId.make(row.agentId),
    sendExternal: permissions.approval_overrides.send_external ?? 'manual',
  }).pipe(
    Effect.mapError(
      (cause) =>
        new MailAgentIdentityError({
          runtimeKey,
          operation: 'resolvePrincipal.decode',
          message: 'Resolved chat agent identity is invalid.',
          cause,
        }),
    ),
  )
})

/** Runs one operation with freshly resolved policy and a server-owned actor. */
const runMailOperation = <A, E>(
  context: MailAgentToolContext,
  operation: (application: MailAgentApplicationService) => Effect.Effect<A, E>,
) => {
  const db = getPooledDb(context.databaseUrl)
  return resolveMailAgentPrincipal(db, context.threadId).pipe(
    Effect.flatMap((principal) => {
      const repositoryLayer = makeMailRepositoryLayer(db)
      const dependencies = Layer.mergeAll(
        repositoryLayer,
        mailDraftApplicationLayer.pipe(Layer.provide(repositoryLayer)),
        Layer.succeed(
          MailAgentDeliveryDispatcher,
          MailAgentDeliveryDispatcher.of({
            dispatch: context.dispatchDelivery,
          }),
        ),
      )
      const applicationLayer = makeMailAgentApplicationLayer(principal).pipe(
        Layer.provide(dependencies),
      )
      return Effect.gen(function* () {
        const application = yield* MailAgentApplication
        return yield* operation(application)
      }).pipe(Effect.provide(applicationLayer))
    }),
  )
}

type ModelFacingError = {
  readonly _tag: string
  readonly message: string
}

/** Converts the Effect error channel once at the AI SDK Promise boundary. */
const executeForModel = async <A, E extends ModelFacingError>(
  effect: Effect.Effect<A, E>,
) => {
  const result = await Effect.runPromise(Effect.result(effect))
  return EffectResult.match(result, {
    onFailure: (failure) => ({
      ok: false as const,
      error: { code: failure._tag, message: failure.message },
    }),
    onSuccess: (value) => ({ ok: true as const, value }),
  })
}

/** Reads the current turn scope at execution time so recovered turns are scoped too. */
const currentScope = (context: MailAgentToolContext) =>
  context.getScope?.() ?? null

/** Rejects model-supplied identifiers outside the server-selected conversation. */
const requireScopedConversation = (
  context: MailAgentToolContext,
  operation: string,
  input: { readonly conversationId: ConversationId },
): Effect.Effect<void, MailAgentScopeError> => {
  const scope = currentScope(context)
  return scope === null || scope.conversationId === input.conversationId
    ? Effect.void
    : Effect.fail(
        new MailAgentScopeError({
          operation,
          message: 'This mail turn is restricted to the selected conversation.',
        }),
      )
}

/** Rejects drafts created outside the server-selected mailbox/conversation. */
const requireScopedDraftTarget = (
  context: MailAgentToolContext,
  input: {
    readonly mailboxId: MailboxId
    readonly conversationId: ConversationId | null
  },
): Effect.Effect<void, MailAgentScopeError> => {
  const scope = currentScope(context)
  return scope === null ||
    (scope.mailboxId === input.mailboxId &&
      scope.conversationId === input.conversationId)
    ? Effect.void
    : Effect.fail(
        new MailAgentScopeError({
          operation: 'mail_create_draft.scope',
          message:
            'This mail turn can create drafts only in the selected conversation.',
        }),
      )
}

/** Proves an edited draft belongs to the server-selected conversation. */
const requireScopedExistingDraft = (
  context: MailAgentToolContext,
  application: MailAgentApplicationService,
  draftId: string,
) => {
  const scope = currentScope(context)
  if (scope === null) return Effect.void
  return application
    .readConversation({ conversationId: scope.conversationId })
    .pipe(
      Effect.flatMap((detail) =>
        detail.drafts.some((draft) => draft.id === draftId)
          ? Effect.void
          : Effect.fail(
              new MailAgentScopeError({
                operation: 'mail_save_draft.scope',
                message:
                  'This mail turn can edit drafts only in the selected conversation.',
              }),
            ),
      ),
    )
}

/**
 * AI SDK adapter for canonical Garden Mail. Read/write tools execute through
 * Effect; delivery request returns an explicit non-send outcome because the
 * current approval continuation cannot attribute a member approval. Auto-send
 * policy dispatches only through the injected durable mail Workflow binding.
 */
export const createGardenMailTools = (
  context: MailAgentToolContext,
): ToolSet => ({
  mail_list_mailboxes: tool({
    description:
      'List Garden mailboxes this agent can access, including access level and primary address.',
    inputSchema: ListMailboxesToolInput,
    execute: () =>
      executeForModel(
        runMailOperation(context, (application) => application.listMailboxes()),
      ),
  }),
  mail_list_conversations: tool({
    description:
      'List accessible Garden Mail conversations, optionally within one mailbox.',
    inputSchema: ListConversationsToolInput,
    execute: (input) =>
      executeForModel(
        runMailOperation(context, (application) =>
          application.listConversations(input),
        ),
      ),
  }),
  mail_read_conversation: tool({
    description:
      'Read one accessible Garden Mail conversation with messages, collaborative drafts, and assignments.',
    inputSchema: ReadConversationToolInput,
    execute: (input) =>
      executeForModel(
        requireScopedConversation(
          context,
          'mail_read_conversation.scope',
          input,
        ).pipe(
          Effect.flatMap(() =>
            runMailOperation(context, (application) =>
              application.readConversation(input),
            ),
          ),
        ),
      ),
  }),
  mail_create_draft: tool({
    description:
      'Create a collaborative Garden Mail draft. This saves only; it never sends email.',
    inputSchema: CreateDraftToolInput,
    execute: (input) =>
      executeForModel(
        requireScopedDraftTarget(context, input).pipe(
          Effect.flatMap(() =>
            runMailOperation(context, (application) =>
              application.createDraft(input),
            ),
          ),
        ),
      ),
  }),
  mail_save_draft: tool({
    description:
      'Save a collaborative Garden Mail draft using its expected revision. This never sends email.',
    inputSchema: SaveDraftToolInput,
    execute: (input) =>
      executeForModel(
        runMailOperation(context, (application) =>
          requireScopedExistingDraft(context, application, input.draftId).pipe(
            Effect.flatMap(() => application.saveDraft(input)),
          ),
        ),
      ),
  }),
  mail_request_draft_delivery: tool({
    description:
      'Request delivery under mailbox access and send-external policy. Manual policy records an approval request; auto policy starts the durable delivery Workflow. Workflow dispatch never claims provider delivery completed.',
    inputSchema: RequestDraftDeliveryToolInput,
    execute: (input) =>
      executeForModel(
        requireScopedConversation(
          context,
          'mail_request_draft_delivery.scope',
          input,
        ).pipe(
          Effect.flatMap(() =>
            runMailOperation(context, (application) =>
              application.requestDraftDelivery(input),
            ),
          ),
        ),
      ),
  }),
})
