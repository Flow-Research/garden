import { Result, TaggedError } from 'better-result'
import { eq } from 'drizzle-orm'
import {
  DEFAULT_TEAM_AGENT_POLICY,
  TeamAgentPolicySchema,
  type TeamAgentPolicy,
  type TeamAgentPolicyResponse,
} from '@garden/core/teams/agent-policy'
import { schema, type Db } from '@/lib/server/db'

export class TeamAgentPolicyError extends TaggedError('TeamAgentPolicyError')<{
  message: string
  cause?: unknown
}>() {}

/**
 * Reads a Team's stored agent policy. No row means no policy, so the response
 * carries the "no limits" default. A stored row is re-validated on read; a row
 * that no longer parses is reported as an error instead of being shown as a
 * policy the admin never saved.
 */
export async function readTeamAgentPolicy(args: {
  db: Db
  teamId: string
  canEdit: boolean
}) {
  return Result.gen(async function* () {
    const rows = yield* Result.await(
      Result.tryPromise({
        try: () =>
          args.db
            .select({
              policy: schema.teamAgentPolicy.policy,
              updatedAt: schema.teamAgentPolicy.updatedAt,
            })
            .from(schema.teamAgentPolicy)
            .where(eq(schema.teamAgentPolicy.teamId, args.teamId))
            .limit(1),
        catch: (cause) =>
          new TeamAgentPolicyError({
            message: 'Failed to load Team agent policy',
            cause,
          }),
      }),
    )
    const row = rows[0]
    if (!row) {
      return Result.ok(
        policyResponse(
          args.teamId,
          DEFAULT_TEAM_AGENT_POLICY,
          null,
          args.canEdit,
        ),
      )
    }
    const parsed = TeamAgentPolicySchema.safeParse(row.policy)
    if (!parsed.success) {
      return Result.err(
        new TeamAgentPolicyError({
          message: 'Stored Team agent policy is invalid',
          cause: parsed.error,
        }),
      )
    }
    return Result.ok(
      policyResponse(args.teamId, parsed.data, row.updatedAt, args.canEdit),
    )
  })
}

/** Replaces a Team's agent policy. The body is already schema-validated. */
export async function writeTeamAgentPolicy(args: {
  db: Db
  teamId: string
  workspaceId: string
  actorUserId: string
  policy: TeamAgentPolicy
}) {
  const updatedAt = new Date()
  return Result.tryPromise({
    try: () =>
      args.db
        .insert(schema.teamAgentPolicy)
        .values({
          teamId: args.teamId,
          workspaceId: args.workspaceId,
          policy: args.policy,
          updatedBy: args.actorUserId,
          updatedAt,
        })
        .onConflictDoUpdate({
          target: schema.teamAgentPolicy.teamId,
          set: {
            policy: args.policy,
            updatedBy: args.actorUserId,
            updatedAt,
          },
        }),
    catch: (cause) =>
      new TeamAgentPolicyError({
        message: 'Failed to save Team agent policy',
        cause,
      }),
  }).then((result) =>
    result.map(() => policyResponse(args.teamId, args.policy, updatedAt, true)),
  )
}

function policyResponse(
  teamId: string,
  policy: TeamAgentPolicy,
  updatedAt: Date | null,
  canEdit: boolean,
): TeamAgentPolicyResponse {
  return {
    team_id: teamId,
    policy,
    can_edit: canEdit,
    updated_at: updatedAt?.toISOString() ?? null,
  }
}
