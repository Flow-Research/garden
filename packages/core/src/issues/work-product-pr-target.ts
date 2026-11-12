import { z } from 'zod'

/**
 * Where "Apply as PR" writes an approved work product (S1-28, #375).
 *
 * Before: Apply could only post a work product as a comment on the bound
 * GitHub issue, so a draft meant to become a repository file had no path to
 * a PR. After: a work product that carries `payload.pr_target` can be
 * applied as a branch + one-file commit + PR. The target lives in the
 * existing `payload` jsonb rather than new columns because it is optional
 * per-type metadata the agent already writes through `create_work_product`,
 * and only the apply path reads it. `repository` is `owner/repo`; `path` is
 * repo-relative; `base_branch` defaults to `dev`, the branch Garden's PR
 * contract requires.
 */
export const workProductPrTargetSchema = z
  .object({
    repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
    path: z
      .string()
      .min(1)
      .refine(
        (path) =>
          !path.startsWith('/') &&
          !path.split('/').some((part) => part === '' || part === '..'),
        'path must be repo-relative without empty or .. segments',
      ),
    base_branch: z.string().min(1).default('dev'),
  })
  .strict()

export type WorkProductPrTarget = z.infer<typeof workProductPrTargetSchema>

/** Reads `payload.pr_target`; null when absent or malformed. */
export function parseWorkProductPrTarget(
  payload: unknown,
): WorkProductPrTarget | null {
  if (!payload || typeof payload !== 'object') return null
  const parsed = workProductPrTargetSchema.safeParse(
    (payload as { pr_target?: unknown }).pr_target,
  )
  return parsed.success ? parsed.data : null
}
