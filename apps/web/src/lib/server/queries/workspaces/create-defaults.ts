import { and, eq } from 'drizzle-orm'
import { DEFAULT_AGENT_PERMISSIONS } from '@garden/core/agents/permissions'
import { deriveIssuePrefix } from '@garden/core/issues/identifier'
import { lockDefaultAgentProvisioning } from '@/lib/server/chat-agents'
import { schema, type Db } from '@/lib/server/db'

const GARDEN_DESCRIPTION =
  'Garden powers chat, can read across the workspace, and can propose new agents for specialised work.'

export type ApplyGardenWorkspaceDefaultsInput = {
  name: string
  slug: string
  userId: string
}

/**
 * After Better Auth creates the organization, sets the issue prefix and ensures
 * the default Garden agent exists. Used by `POST /api/workspaces` create-service
 * so the route stays free of Drizzle.
 *
 * Before: this transaction lived inline in the workspaces route. After: queries
 * own the SQL; the service wraps Result + best-effort skill seeding.
 */
export async function applyGardenWorkspaceDefaults(
  db: Db,
  input: ApplyGardenWorkspaceDefaultsInput,
) {
  return await db.transaction(async (tx) => {
    const now = new Date()
    const agentId = crypto.randomUUID()
    const [workspace] = await tx
      .update(schema.organization)
      .set({
        issuePrefix: deriveIssuePrefix(input.name),
        updatedAt: now,
      })
      .where(eq(schema.organization.slug, input.slug))
      .returning()

    if (!workspace) {
      return null
    }

    await lockDefaultAgentProvisioning(tx, workspace.id)
    const [existingDefault] = await tx
      .select({ id: schema.agent.id })
      .from(schema.agent)
      .where(
        and(
          eq(schema.agent.workspaceId, workspace.id),
          eq(schema.agent.isDefault, true),
        ),
      )
    if (!existingDefault) {
      await tx.insert(schema.agent).values({
        id: agentId,
        workspaceId: workspace.id,
        ownerUserId: input.userId,
        name: 'Garden',
        roleTitle: GARDEN_DESCRIPTION,
        isDefault: true,
        status: 'active',
        hostName: agentId,
        permissions: DEFAULT_AGENT_PERMISSIONS,
        createdAt: now,
      })
    }

    return workspace
  })
}
