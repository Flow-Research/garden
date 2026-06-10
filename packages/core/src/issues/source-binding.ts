import { desc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/neon-serverless'
import { Result, TaggedError, type Result as ResultValue } from 'better-result'
import type { IssueSourceBinding } from '../types/issue-work-product'
import * as schema from '@garden/db/schema'
import {
  issueSourceBindingInsertSchema,
  issueSourceBindingSelectSchema,
} from '@garden/db/validation'
import { z } from 'zod'

export class IssueSourceBindingServiceError extends TaggedError(
  'IssueSourceBindingServiceError',
)<{
  code: 'binding_not_found' | 'validation_failed' | 'db_error'
  message: string
  cause?: unknown
}>() {}

const attachSourceBindingInputSchema = z
  .object({
    databaseUrl: z.string().trim().min(1),
    workspaceId: issueSourceBindingInsertSchema.shape.workspaceId,
    issueId: issueSourceBindingInsertSchema.shape.issueId,
    connectorId: issueSourceBindingInsertSchema.shape.connectorId,
    sourceKind: issueSourceBindingInsertSchema.shape.sourceKind,
    externalId: z.string().trim().min(1),
    externalUrl: z.string().trim().min(1).optional().nullable(),
  })
  .strict()

const removeSourceBindingInputSchema = z
  .object({
    databaseUrl: z.string().trim().min(1),
    bindingId: issueSourceBindingSelectSchema.shape.id,
  })
  .strict()

const listIssueSourceBindingsInputSchema = z
  .object({
    databaseUrl: z.string().trim().min(1),
    issueId: issueSourceBindingSelectSchema.shape.issueId,
  })
  .strict()

export type AttachSourceBindingInput = z.infer<
  typeof attachSourceBindingInputSchema
>

export type RemoveSourceBindingInput = z.infer<
  typeof removeSourceBindingInputSchema
>

export type ListIssueSourceBindingsInput = z.infer<
  typeof listIssueSourceBindingsInputSchema
>

type IssueSourceBindingDb = ReturnType<typeof getIssueSourceBindingDb>
type IssueSourceBindingTx = Parameters<
  Parameters<IssueSourceBindingDb['transaction']>[0]
>[0]
type IssueSourceBindingExecutor = IssueSourceBindingDb | IssueSourceBindingTx

export function getIssueSourceBindingDb(databaseUrl: string) {
  return drizzle(databaseUrl, { schema })
}

function serviceDbError(operation: string, cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause)
  return new IssueSourceBindingServiceError({
    code: 'db_error',
    message: `${operation} failed: ${message}`,
    cause,
  })
}

function validationError(message: string) {
  return new IssueSourceBindingServiceError({
    code: 'validation_failed',
    message,
  })
}

function dateToIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null
}

function objectOrNull(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function sourceDisplayRef(input: {
  sourceKind: string
  externalId: string
  externalUrl?: string | null
}) {
  return input.externalUrl?.trim() || `${input.sourceKind}:${input.externalId}`
}

export function toIssueSourceBinding(
  row: typeof schema.issueSourceBinding.$inferSelect,
): IssueSourceBinding {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    issue_id: row.issueId,
    connector_id: row.connectorId,
    source_kind: row.sourceKind,
    external_id: row.externalId,
    external_url: row.externalUrl ?? null,
    display_ref: row.displayRef ?? null,
    title_snapshot: row.titleSnapshot ?? null,
    metadata: objectOrNull(row.metadata),
    last_synced_at: dateToIso(row.lastSyncedAt),
    created_at: dateToIso(row.createdAt) ?? new Date().toISOString(),
    updated_at: dateToIso(row.updatedAt) ?? new Date().toISOString(),
  }
}

async function refreshIssueSourceSummary(
  executor: IssueSourceBindingExecutor,
  issueId: string,
) {
  const [binding] = await executor
    .select({
      displayRef: schema.issueSourceBinding.displayRef,
      sourceKind: schema.issueSourceBinding.sourceKind,
      externalId: schema.issueSourceBinding.externalId,
      externalUrl: schema.issueSourceBinding.externalUrl,
    })
    .from(schema.issueSourceBinding)
    .where(eq(schema.issueSourceBinding.issueId, issueId))
    .orderBy(desc(schema.issueSourceBinding.updatedAt))
    .limit(1)
  const sourceSummary = binding
    ? binding.displayRef ??
      sourceDisplayRef({
        sourceKind: binding.sourceKind,
        externalId: binding.externalId,
        externalUrl: binding.externalUrl,
      })
    : null

  await executor
    .update(schema.issue)
    .set({ sourceSummary, updatedAt: new Date() })
    .where(eq(schema.issue.id, issueId))
}

export async function attachSourceBindingInTransaction(
  executor: IssueSourceBindingExecutor,
  input: Omit<AttachSourceBindingInput, 'databaseUrl'>,
): Promise<{ binding_id: string }> {
  const displayRef = sourceDisplayRef(input)
  const [binding] = await executor
    .insert(schema.issueSourceBinding)
    .values({
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      issueId: input.issueId,
      connectorId: input.connectorId,
      sourceKind: input.sourceKind,
      externalId: input.externalId,
      externalUrl: input.externalUrl ?? null,
      displayRef,
    })
    .returning({ id: schema.issueSourceBinding.id })

  await executor
    .update(schema.issue)
    .set({ sourceSummary: displayRef, updatedAt: new Date() })
    .where(eq(schema.issue.id, input.issueId))

  return { binding_id: binding!.id }
}

export async function attachSourceBinding(
  input: AttachSourceBindingInput,
): Promise<ResultValue<{ binding_id: string }, IssueSourceBindingServiceError>> {
  const parsed = attachSourceBindingInputSchema.safeParse(input)
  if (!parsed.success) {
    return Result.err(validationError(parsed.error.issues[0]?.message ?? 'Invalid source binding.'))
  }

  const db = getIssueSourceBindingDb(parsed.data.databaseUrl)
  const result = await Result.tryPromise({
    try: async () =>
      await db.transaction(async (tx) =>
        await attachSourceBindingInTransaction(tx, {
          workspaceId: parsed.data.workspaceId,
          issueId: parsed.data.issueId,
          connectorId: parsed.data.connectorId,
          sourceKind: parsed.data.sourceKind,
          externalId: parsed.data.externalId,
          externalUrl: parsed.data.externalUrl,
        }),
      ),
    catch: (cause) => serviceDbError('attach source binding', cause),
  })
  if (result.isErr()) return Result.err(result.error)
  return Result.ok(result.value)
}

export async function removeSourceBinding(
  input: RemoveSourceBindingInput,
): Promise<ResultValue<void, IssueSourceBindingServiceError>> {
  const parsed = removeSourceBindingInputSchema.safeParse(input)
  if (!parsed.success) {
    return Result.err(validationError(parsed.error.issues[0]?.message ?? 'Invalid source binding.'))
  }

  const db = getIssueSourceBindingDb(parsed.data.databaseUrl)
  const result = await Result.tryPromise({
    try: async () =>
      await db.transaction(async (tx) => {
        const [binding] = await tx
          .select({ issueId: schema.issueSourceBinding.issueId })
          .from(schema.issueSourceBinding)
          .where(eq(schema.issueSourceBinding.id, parsed.data.bindingId))
          .limit(1)
        if (!binding) return { kind: 'missing' as const }

        await tx
          .delete(schema.issueSourceBinding)
          .where(eq(schema.issueSourceBinding.id, parsed.data.bindingId))
        await refreshIssueSourceSummary(tx, binding.issueId)
        return { kind: 'removed' as const }
      }),
    catch: (cause) => serviceDbError('remove source binding', cause),
  })
  if (result.isErr()) return Result.err(result.error)
  if (result.value.kind === 'missing') {
    return Result.err(
      new IssueSourceBindingServiceError({
        code: 'binding_not_found',
        message: 'Source binding not found.',
      }),
    )
  }
  return Result.ok()
}

export async function listIssueSourceBindings(
  input: ListIssueSourceBindingsInput,
): Promise<ResultValue<IssueSourceBinding[], IssueSourceBindingServiceError>> {
  const parsed = listIssueSourceBindingsInputSchema.safeParse(input)
  if (!parsed.success) {
    return Result.err(validationError(parsed.error.issues[0]?.message ?? 'Invalid issue id.'))
  }

  const db = getIssueSourceBindingDb(parsed.data.databaseUrl)
  const result = await Result.tryPromise({
    try: async () =>
      await db
        .select()
        .from(schema.issueSourceBinding)
        .where(eq(schema.issueSourceBinding.issueId, parsed.data.issueId))
        .orderBy(desc(schema.issueSourceBinding.updatedAt)),
    catch: (cause) => serviceDbError('list source bindings', cause),
  })
  if (result.isErr()) return Result.err(result.error)
  return Result.ok(result.value.map(toIssueSourceBinding))
}
