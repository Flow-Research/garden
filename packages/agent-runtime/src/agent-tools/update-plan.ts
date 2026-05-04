import { Result } from 'better-result'
import { tool } from 'ai'
import { z } from 'zod'
import {
  IssueRunToolError,
  requireRunState,
  toolErrorResult,
  toolOkResult,
  type IssueRunToolContext,
} from './issue-run-tool-context'

export const updatePlanInputSchema = z
  .object({
    todos: z
      .array(
        z
          .object({
            content: z.string().trim().min(1),
            status: z.enum(['pending', 'in_progress', 'completed']),
            activeForm: z.string().trim().min(1),
          })
          .strict(),
      )
      .min(1)
      .refine(
        (todos) =>
          todos.filter((todo) => todo.status === 'in_progress').length <= 1,
        'At most one todo can be in progress.',
      ),
  })
  .strict()

function ensurePlanTable(storageSql: SqlStorage) {
  return Result.try({
    try: () => {
      storageSql.exec(`
        CREATE TABLE IF NOT EXISTS issue_run_plan (
          run_id TEXT PRIMARY KEY,
          todos_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `)
    },
    catch: (cause) =>
      new IssueRunToolError({
        code: 'database_failed',
        message:
          cause instanceof Error
            ? cause.message
            : 'Failed to prepare issue run plan storage.',
        cause,
      }),
  })
}

export function readIssueRunPlan(
  storageSql: SqlStorage,
  runId: string,
): Array<z.infer<typeof updatePlanInputSchema>['todos'][number]> | null {
  const tableResult = ensurePlanTable(storageSql)
  if (tableResult.isErr()) return null

  const rows = Array.from(
    storageSql.exec(
      `
        SELECT todos_json
        FROM issue_run_plan
        WHERE run_id = ?
        LIMIT 1
      `,
      runId,
    ),
  ) as Array<{ todos_json: string }>
  const row = rows[0]
  if (!row) return null

  const parsedJson = Result.try({
    try: () => JSON.parse(row.todos_json) as unknown,
    catch: () => null,
  })
  if (parsedJson.isErr() || !parsedJson.value) return null

  const parsed = updatePlanInputSchema.shape.todos.safeParse(parsedJson.value)
  return parsed.success ? parsed.data : null
}

export function createUpdatePlanTool(context: IssueRunToolContext) {
  return tool({
    description:
      'Update the live working plan for this issue run. Store concrete todos with exactly one in_progress item.',
    inputSchema: updatePlanInputSchema,
    execute: async (input) => {
      const runResult = requireRunState(context)
      if (runResult.isErr()) return toolErrorResult(runResult.error)
      const tableResult = ensurePlanTable(context.storageSql)
      if (tableResult.isErr()) return toolErrorResult(tableResult.error)

      const writeResult = Result.try({
        try: () => {
          context.storageSql.exec(
            `
              INSERT INTO issue_run_plan (run_id, todos_json, updated_at)
              VALUES (?, ?, ?)
              ON CONFLICT(run_id) DO UPDATE SET
                todos_json = excluded.todos_json,
                updated_at = excluded.updated_at
            `,
            runResult.value.runId,
            JSON.stringify(input.todos),
            new Date().toISOString(),
          )
        },
        catch: (cause) =>
          new IssueRunToolError({
            code: 'database_failed',
            message:
              cause instanceof Error
                ? cause.message
                : 'Failed to update issue run plan.',
            cause,
          }),
      })
      if (writeResult.isErr()) return toolErrorResult(writeResult.error)

      return toolOkResult({
        todos: input.todos,
      })
    },
  })
}
