import { Result, TaggedError, type Result as ResultValue } from "better-result";
import { tool } from "ai";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { DEFAULT_AGENT_PERMISSIONS } from "@garden/core/agents/permissions";
import * as schema from "@garden/db/schema";

const agentInputSchema = createInsertSchema(schema.agent, {
  name: (field) => field.trim().min(1),
});
const skillInputSchema = createInsertSchema(schema.skill, {
  slug: (field) => field.trim().min(1),
});

export const proposeAgentInputSchema = z
  .object({
    name: agentInputSchema.shape.name.describe("Proposed display name."),
    role: z.string().trim().min(1).describe("One-line role description."),
    description: z.string().trim().max(500).optional(),
    skills: z
      .array(skillInputSchema.shape.slug)
      .optional()
      .describe(
        "Exact skill slugs from Available workspace skills. Do not invent skill slugs for connectors or capabilities.",
      ),
    connector_requirements: z
      .array(z.string().trim().min(1))
      .optional()
      .describe(
        "Connector or capability needs in plain text, such as exa-search.search. Use this for connector tools instead of inventing skill slugs.",
      ),
    source_issue_id: z.string().uuid().optional(),
  })
  .strict();

type ProposeAgentInput = z.infer<typeof proposeAgentInputSchema>;

type ProposeAgentResult = {
  permission_request_id: string;
  pending_agent_id: string;
};

type ProposeAgentContext = {
  databaseUrl?: string;
  threadId?: string;
};

type RuntimeIdentity = {
  threadId: string;
  workspaceId: string;
  ownerUserId: string;
  agentId: string;
  isDefault: boolean;
};

class ProposeAgentToolError extends TaggedError("ProposeAgentToolError")<{
  code:
    | "not_configured"
    | "thread_not_found"
    | "agent_not_allowed"
    | "source_issue_not_found"
    | "skill_not_found"
    | "database_failed";
  message: string;
}>() {}

function getDb(databaseUrl: string) {
  return drizzle(databaseUrl, { schema });
}

function dbErrorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

function uniqueSkillSlugs(skills: string[] | undefined) {
  return [...new Set((skills ?? []).map((skill) => skill.trim()))];
}

function pendingAgentContext(pendingAgentId: string) {
  return `agent_proposal:${pendingAgentId}`;
}

function pendingAgentIdFromContext(value: string | null) {
  const prefix = "agent_proposal:";
  return value?.startsWith(prefix) ? value.slice(prefix.length) : null;
}

async function loadRuntimeIdentity(
  context: Required<ProposeAgentContext>,
): Promise<ResultValue<RuntimeIdentity, ProposeAgentToolError>> {
  const db = getDb(context.databaseUrl);
  const result = await Result.tryPromise({
    try: async () =>
      db
        .select({
          threadId: schema.chatThread.id,
          workspaceId: schema.chatThread.workspaceId,
          ownerUserId: schema.chatThread.ownerUserId,
          agentId: schema.chatThread.agentId,
          isDefault: sql<boolean>`coalesce("agent"."is_default", false)`,
        })
        .from(schema.chatThread)
        .innerJoin(schema.agent, eq(schema.agent.id, schema.chatThread.agentId))
        .where(eq(schema.chatThread.id, context.threadId))
        .limit(1),
    catch: (cause) =>
      new ProposeAgentToolError({
        code: "database_failed",
        message: dbErrorMessage(cause, "Failed to load proposing agent."),
      }),
  });
  if (result.isErr()) return Result.err(result.error);

  const identity = result.value[0];
  return identity
    ? Result.ok(identity)
    : Result.err(
        new ProposeAgentToolError({
          code: "thread_not_found",
          message: "Chat thread not found.",
        }),
      );
}

function requireConfiguredContext(
  context: ProposeAgentContext,
): ResultValue<Required<ProposeAgentContext>, ProposeAgentToolError> {
  return context.databaseUrl && context.threadId
    ? Result.ok({
        databaseUrl: context.databaseUrl,
        threadId: context.threadId,
      })
    : Result.err(
        new ProposeAgentToolError({
          code: "not_configured",
          message: "Agent proposal tools are not configured.",
        }),
      );
}

async function proposeAgent(
  context: ProposeAgentContext,
  input: ProposeAgentInput,
): Promise<ResultValue<ProposeAgentResult, ProposeAgentToolError>> {
  const configuredContext = requireConfiguredContext(context);
  if (configuredContext.isErr()) return Result.err(configuredContext.error);

  const identityResult = await loadRuntimeIdentity(configuredContext.value);
  if (identityResult.isErr()) return Result.err(identityResult.error);
  const identity = identityResult.value;

  if (!identity.isDefault) {
    return Result.err(
      new ProposeAgentToolError({
        code: "agent_not_allowed",
        message: "This agent is not allowed to propose new agents.",
      }),
    );
  }

  const db = getDb(configuredContext.value.databaseUrl);
  const pendingAgentId = crypto.randomUUID();
  const permissionRequestId = crypto.randomUUID();
  const skillSlugs = uniqueSkillSlugs(input.skills);
  const description = input.description?.trim() || null;
  const payload = {
    name: input.name,
    role: input.role,
    description: description,
    skills: skillSlugs,
    connector_requirements: input.connector_requirements ?? [],
    source_issue_id: input.source_issue_id ?? null,
  };

  const writeResult = await Result.tryPromise({
    try: async () => {
      await db.transaction(async (tx) => {
        if (input.source_issue_id) {
          const [sourceIssue] = await tx
            .select({ id: schema.issue.id })
            .from(schema.issue)
            .where(
              and(
                eq(schema.issue.id, input.source_issue_id),
                eq(schema.issue.workspaceId, identity.workspaceId),
              ),
            )
            .limit(1);

          if (!sourceIssue) {
            throw new ProposeAgentToolError({
              code: "source_issue_not_found",
              message: "Source issue not found in this workspace.",
            });
          }
        }

        const skillRows =
          skillSlugs.length > 0
            ? await tx
                .select({ id: schema.skill.id, slug: schema.skill.slug })
                .from(schema.skill)
                .where(
                  and(
                    eq(schema.skill.workspaceId, identity.workspaceId),
                    inArray(schema.skill.slug, skillSlugs),
                  ),
                )
            : [];

        const foundSkillSlugs = new Set(skillRows.map((row) => row.slug));
        const missingSkillSlugs = skillSlugs.filter(
          (skill) => !foundSkillSlugs.has(skill),
        );
        if (missingSkillSlugs.length > 0) {
          throw new ProposeAgentToolError({
            code: "skill_not_found",
            message: `Skill not found in workspace catalog: ${missingSkillSlugs.join(", ")}`,
          });
        }

        await tx.execute(sql`
          insert into agent (
            id,
            workspace_id,
            owner_user_id,
            name,
            role_title,
            instructions,
            permissions,
            status,
            adapter_type,
            host_name
          )
          values (
            ${pendingAgentId}::uuid,
            ${identity.workspaceId}::uuid,
            ${identity.ownerUserId}::uuid,
            ${input.name},
            ${input.role},
            ${description},
            ${JSON.stringify(DEFAULT_AGENT_PERMISSIONS)}::jsonb,
            'pending_approval',
            'workspace-agent',
            ${pendingAgentId}
          )
        `);

        if (skillRows.length > 0) {
          await tx.insert(schema.agentSkill).values(
            skillRows.map((skill) => ({
              agentId: pendingAgentId,
              skillId: skill.id,
              enabled: true,
            })),
          );
        }

        await tx.execute(sql`
          insert into permission_request (
            id,
            agent_id,
            kind,
            capability_id,
            context,
            issue_id,
            thread_id,
            args_json,
            tool_call_id,
            status,
            requested_at
          )
          values (
            ${permissionRequestId}::uuid,
            ${identity.agentId}::uuid,
            'agent_proposal',
            null,
            ${pendingAgentContext(pendingAgentId)},
            ${input.source_issue_id ?? null}::uuid,
            ${configuredContext.value.threadId}::uuid,
            ${JSON.stringify(payload)}::jsonb,
            ${permissionRequestId},
            'pending',
            now()
          )
        `);
      });
    },
    catch: (cause) =>
      cause instanceof ProposeAgentToolError
        ? cause
        : new ProposeAgentToolError({
            code: "database_failed",
            message: dbErrorMessage(cause, "Failed to persist agent proposal."),
          }),
  });
  if (writeResult.isErr()) return Result.err(writeResult.error);

  return Result.ok({
    permission_request_id: permissionRequestId,
    pending_agent_id: pendingAgentId,
  });
}

function serializeError(error: ProposeAgentToolError) {
  return {
    ok: false as const,
    code: error.code,
    error: error.message,
  };
}

export function createProposeAgentTool(context: ProposeAgentContext) {
  return tool({
    description:
      "Propose a new workspace agent for user approval. Only the default Garden agent can use this. " +
      "Creates a pending agent and an agent_proposal permission request. Use only after checking workspace inventory and confirming no existing active agent, including the current agent, is the right assignee. " +
      "Use this for reusable agent roles, not one-off research topics or issue-specific job titles. Only pass exact known skill slugs; put connector/tool needs in connector_requirements.",
    inputSchema: proposeAgentInputSchema,
    execute: async (input) => {
      const result = await proposeAgent(context, input);
      return result.isOk() ? result.value : serializeError(result.error);
    },
  });
}

export { pendingAgentIdFromContext, ProposeAgentToolError };
