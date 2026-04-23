import { and, eq } from 'drizzle-orm'
import { env } from 'cloudflare:workers'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'

export function buildPrimaryAgentName(workspaceId: string, userId: string) {
  return `${workspaceId}:${userId}:primary`
}

async function getPrimaryAgentStub(agentName: string) {
  const stub = env.PrimaryAgent.get(env.PrimaryAgent.idFromName(agentName))

  if ('setName' in stub && typeof stub.setName === 'function') {
    await stub.setName(agentName)
  }

  return stub
}

export async function ensurePrimaryControlPlaneAgent(input: {
  workspaceId: string
  ownerUserId: string
  agentName: string
}) {
  const db = getDb(appEnv)
  const [existingAgent] = await db
    .select()
    .from(schema.agent)
    .where(
      and(
        eq(schema.agent.workspaceId, input.workspaceId),
        eq(schema.agent.ownerUserId, input.ownerUserId),
        eq(schema.agent.doId, input.agentName),
      ),
    )

  if (existingAgent) {
    return existingAgent
  }

  const [createdAgent] = await db
    .insert(schema.agent)
    .values({
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      ownerUserId: input.ownerUserId,
      name: 'Primary Agent',
      roleTitle: 'Chat agent',
      status: 'active',
      doId: input.agentName,
    })
    .returning()

  return createdAgent
}

export async function ensureChatThreadAgent(input: {
  threadId: string
  agentName: string
}) {
  const stub = await getPrimaryAgentStub(input.agentName)
  await stub.ensureThread(input.threadId)
}

export async function ensureChatThreadAgents(
  threads: Array<{
    id: string
    agentName: string
  }>,
) {
  await Promise.all(
    threads.map((thread) =>
      ensureChatThreadAgent({
        threadId: thread.id,
        agentName: thread.agentName,
      }),
    ),
  )
}

export async function deleteChatThreadAgent(input: {
  threadId: string
  agentName: string
}) {
  const stub = await getPrimaryAgentStub(input.agentName)
  await stub.deleteThread(input.threadId)
}

export async function refreshChatThreadSkillInventory(input: {
  threadId: string
  agentName: string
}) {
  const stub = await getPrimaryAgentStub(input.agentName)
  await stub.refreshThreadSkills(input.threadId)
}

export async function debugChatThreadAgent(input: {
  threadId: string
  agentName: string
}) {
  const stub = await getPrimaryAgentStub(input.agentName)
  return stub.debugThread(input.threadId)
}
