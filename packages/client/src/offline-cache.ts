import { Result } from 'better-result'
import { z } from 'zod'
import {
  ClientReadFailure,
  parseGardenOrigin,
  runPreviewSchema,
  taskPreviewSchema,
  threadPreviewSchema,
  workspacePreviewSchema,
} from './client'

/** Saved projections never establish current server authority. */
export const offlineSnapshotSchema = z
  .object({
    version: z.literal(1),
    origin: z.string().refine((value) => parseGardenOrigin(value).isOk()),
    accountId: z.string().min(1),
    workspaceId: z.string().min(1),
    expiresAt: z.number().int().positive(),
    syncedAt: z.number().int().nonnegative(),
    workspaces: z.array(workspacePreviewSchema).max(100),
    tasks: z.array(taskPreviewSchema).max(50),
    threads: z.array(threadPreviewSchema).max(100),
    run: runPreviewSchema.nullable(),
    selectedTaskId: z.string().nullable(),
    selectedRunId: z.string().nullable(),
    skillsCount: z.number().int().nonnegative().nullable(),
  })
  .superRefine((value, context) => {
    if (
      !value.workspaces.some((row) => row.id === value.workspaceId) ||
      value.tasks.some((row) => row.workspace_id !== value.workspaceId) ||
      value.threads.some((row) => row.workspaceId !== value.workspaceId) ||
      (value.selectedTaskId !== null &&
        !value.tasks.some((row) => row.id === value.selectedTaskId)) ||
      (value.run !== null &&
        (value.run.workspace_id !== value.workspaceId ||
          value.run.issue_id !== value.selectedTaskId ||
          value.run.id !== value.selectedRunId)) ||
      value.expiresAt <= value.syncedAt
    )
      context.addIssue({
        code: 'custom',
        message: 'Saved scope is inconsistent',
      })
  })

export type OfflineSnapshot = z.infer<typeof offlineSnapshotSchema>

/** A fixed storage budget prevents unbounded private data retention. */
export const offlineCacheMaxCharacters = 24_576

/** Decodes untrusted device content before any private view is restored. */
export function decodeOfflineSnapshot(raw: string) {
  if (raw.length > offlineCacheMaxCharacters)
    return Result.err(
      new ClientReadFailure({
        code: 'response',
        message: 'Saved reads exceed the device limit',
      }),
    )
  return Result.try({
    try: () => JSON.parse(raw) as unknown,
    catch: () =>
      new ClientReadFailure({
        code: 'response',
        message: 'Saved reads are invalid',
      }),
  }).andThen((value) => {
    const parsed = offlineSnapshotSchema.safeParse(value)
    return parsed.success
      ? Result.ok(parsed.data)
      : Result.err(
          new ClientReadFailure({
            code: 'response',
            message: 'Saved reads are invalid or exceed the device limit',
          }),
        )
  })
}
