import { and, eq } from 'drizzle-orm'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'

// Server-side helpers for managing AgentHost DOs + their WorkspaceAgent
// thread facets. The `agent` table row carries the persona/config; the host
// DO runs the runtime; each thread is a facet keyed by threadId.

export function buildAgentHostName(workspaceId: string, userId: string) {
  return `${workspaceId}:${userId}:primary`
}

async function getAgentHostStub(hostName: string) {
  const stub = appEnv.AgentHost.get(appEnv.AgentHost.idFromName(hostName))

  if ('setName' in stub && typeof stub.setName === 'function') {
    await stub.setName(hostName)
  }

  return stub
}

export async function ensureAgentRow(input: {
  workspaceId: string
  ownerUserId: string
  hostName: string
}) {
  const db = getDb(appEnv)
  const [existingAgent] = await db
    .select()
    .from(schema.agent)
    .where(
      and(
        eq(schema.agent.workspaceId, input.workspaceId),
        eq(schema.agent.ownerUserId, input.ownerUserId),
        eq(schema.agent.hostName, input.hostName),
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
      name: 'Agent',
      roleTitle: null,
      status: 'active',
      hostName: input.hostName,
    })
    .returning()

  return createdAgent
}

export async function ensureChatThreadAgent(input: {
  threadId: string
  hostName: string
}) {
  const stub = await getAgentHostStub(input.hostName)
  await stub.ensureThread(input.threadId)
}

/**
 * Ensure-and-fetch: provisions the thread facet (idempotent) and returns its
 * current message log in a single DO RPC. Used by the thread GET endpoint to
 * collapse two RTTs into one for the chat loader.
 */
export async function getChatThreadMessages(input: {
  threadId: string
  hostName: string
}) {
  const stub = await getAgentHostStub(input.hostName)
  return stub.getChatMessages(input.threadId)
}

export async function ensureChatThreadAgents(
  threads: Array<{
    id: string
    hostName: string
  }>,
) {
  await Promise.all(
    threads.map((thread) =>
      ensureChatThreadAgent({
        threadId: thread.id,
        hostName: thread.hostName,
      }),
    ),
  )
}

export async function deleteChatThreadAgent(input: {
  threadId: string
  hostName: string
}) {
  const stub = await getAgentHostStub(input.hostName)
  await stub.deleteThread(input.threadId)
}

export async function refreshChatThreadSkillInventory(input: {
  threadId: string
  hostName: string
}) {
  const stub = await getAgentHostStub(input.hostName)
  await stub.refreshThreadSkills(input.threadId)
}

export async function refreshChatThreadPromptConfig(input: {
  threadId: string
  hostName: string
}) {
  const stub = await getAgentHostStub(input.hostName)
  await stub.refreshThreadPrompt(input.threadId)
}

export async function debugChatThreadMeta(input: {
  threadId: string
  hostName: string
}) {
  const stub = await getAgentHostStub(input.hostName)
  return stub.debugThreadMeta(input.threadId)
}

export async function debugChatThreadWorkspace(input: {
  threadId: string
  hostName: string
}) {
  const stub = await getAgentHostStub(input.hostName)
  return stub.debugThreadWorkspace(input.threadId)
}

export async function debugChatThreadSandbox(input: {
  threadId: string
  hostName: string
}) {
  const stub = await getAgentHostStub(input.hostName)
  return stub.debugThreadSandbox(input.threadId)
}

export async function debugChatThreadTools(input: {
  threadId: string
  hostName: string
}) {
  const stub = await getAgentHostStub(input.hostName)
  return stub.debugThreadTools(input.threadId)
}

export async function debugChatThreadPrompt(input: {
  threadId: string
  hostName: string
}) {
  const stub = await getAgentHostStub(input.hostName)
  return stub.debugThreadPrompt(input.threadId)
}
