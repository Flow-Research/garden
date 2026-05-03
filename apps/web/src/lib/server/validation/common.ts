import { Result, TaggedError } from 'better-result'
import { z } from 'zod'

export const nonEmptyStringSchema = z.string().trim().min(1)
export const optionalNonEmptyString = z.string().trim().min(1).optional()
export const nullableOptionalString = z.string().optional().nullable()

export const queryIntSchema = z.coerce.number().int()
export const positiveQueryIntSchema = queryIntSchema.positive()
export const nonNegativeQueryIntSchema = queryIntSchema.min(0)
export const datetimeStringSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid datetime')

export class ApiValidationError extends TaggedError('ApiValidationError')<{
  message: string
}>() {}

function formatValidationMessage(fallbackMessage: string, error: z.ZodError) {
  const issue = error.issues[0]
  if (!issue) return fallbackMessage

  const path = issue.path.join('.')
  return path ? `${path}: ${issue.message}` : issue.message
}

function parseWithSchema<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
  fallbackMessage: string,
) {
  const parsed = schema.safeParse(input)
  return parsed.success
    ? Result.ok(parsed.data)
    : Result.err(
        new ApiValidationError({
          message: formatValidationMessage(fallbackMessage, parsed.error),
        }),
      )
}

export async function parseJsonBody<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
  fallbackMessage: string,
) {
  const bodyResult = await Result.tryPromise({
    try: async () => await request.json(),
    catch: () =>
      new ApiValidationError({
        message: fallbackMessage,
      }),
  })

  if (bodyResult.isErr()) return bodyResult
  return parseWithSchema(schema, bodyResult.value, fallbackMessage)
}

export function parseSearchParams<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
  fallbackMessage: string,
) {
  const url = new URL(request.url)
  const raw = Object.fromEntries(url.searchParams.entries())
  return parseWithSchema(schema, raw, fallbackMessage)
}
