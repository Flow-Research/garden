import { and, eq } from 'drizzle-orm'
import { getAgentByName } from 'agents'
import type { AgentDO } from '@garden/agent-runtime'
import {
  bindExistingCapabilitiesToAgent,
  bindExistingSkillsToAgent,
} from './agent-bindings'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import { DEFAULT_AGENT_PERMISSIONS } from '@garden/core/agents/permissions'
import { disposeRpcResult } from '@garden/core/platform/rpc'

type AgentRuntimeStub = DurableObjectStub<AgentDO>

async function getAgentRuntimeStub(hostName: string): Promise<AgentRuntimeStub> {
  return getAgentByName(appEnv.AgentDO, hostName)
}

async function callChatThreadRuntime<T>(
  input: { hostName: string; threadId: string },
  call: (stub: AgentRuntimeStub, threadId: string) => T | Promise<T>,
): Promise<Awaited<T>> {
  const stub = await getAgentRuntimeStub(input.hostName)
  return disposeRpcResult(await call(stub, input.threadId))
}

export async function ensureAgentRow(input: {
  workspaceId: string
  ownerUserId: string
}) {
  const db = getDb(appEnv)
  const [existingAgent] = await db
    .select()
    .from(schema.agent)
    .where(
      and(
        eq(schema.agent.workspaceId, input.workspaceId),
        eq(schema.agent.isDefault, true),
      ),
    )

  if (existingAgent) {
    return existingAgent
  }

  const agentId = crypto.randomUUID()
  const [createdAgent] = await db
    .insert(schema.agent)
    .values({
      id: agentId,
      workspaceId: input.workspaceId,
      ownerUserId: input.ownerUserId,
      name: 'Garden',
      roleTitle: null,
      isDefault: true,
      status: 'active',
      hostName: agentId,
      permissions: DEFAULT_AGENT_PERMISSIONS,
    })
    .returning()

  await bindExistingSkillsToAgent({
    db,
    schema,
    agentId: createdAgent.id,
    workspaceId: input.workspaceId,
  })
  await bindExistingCapabilitiesToAgent({
    db,
    schema,
    agentId: createdAgent.id,
    grantedBy: input.ownerUserId,
  })

  return createdAgent
}

export async function ensureChatThreadAgent(input: {
  threadId: string
  hostName: string
}) {
  await callChatThreadRuntime(input, (stub, threadId) =>
    stub.ensureThread(threadId),
  )
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
  await callChatThreadRuntime(input, (stub, threadId) =>
    stub.deleteThread(threadId),
  )
}

export async function pauseChatThreadAgent(input: {
  threadId: string
  hostName: string
}) {
  await callChatThreadRuntime(input, (stub, threadId) =>
    stub.pauseThread(threadId),
  )
}

export async function refreshChatThreadSkillInventory(input: {
  threadId: string
  hostName: string
}) {
  await callChatThreadRuntime(input, (stub, threadId) =>
    stub.refreshThreadSkills(threadId),
  )
}

export async function refreshChatThreadPromptConfig(input: {
  threadId: string
  hostName: string
}) {
  await callChatThreadRuntime(input, (stub, threadId) =>
    stub.refreshThreadPrompt(threadId),
  )
}

export async function debugChatThreadMeta(input: {
  threadId: string
  hostName: string
}) {
  return callChatThreadRuntime(input, (stub, threadId) =>
    stub.debugThreadMeta(threadId),
  )
}

export async function debugChatThreadWorkspace(input: {
  threadId: string
  hostName: string
}) {
  return callChatThreadRuntime(input, (stub, threadId) =>
    stub.debugThreadWorkspace(threadId),
  )
}

export async function debugChatThreadSandbox(input: {
  threadId: string
  hostName: string
}) {
  return callChatThreadRuntime(input, (stub, threadId) =>
    stub.debugThreadSandbox(threadId),
  )
}

export async function debugChatThreadTools(input: {
  threadId: string
  hostName: string
}) {
  return callChatThreadRuntime(input, (stub, threadId) =>
    stub.debugThreadTools(threadId),
  )
}

export async function debugChatThreadPrompt(input: {
  threadId: string
  hostName: string
}) {
  return callChatThreadRuntime(input, (stub, threadId) =>
    stub.debugThreadPrompt(threadId),
  )
}

export async function uploadChatThreadDocument(input: {
  base64: string
  filename: string
  hostName: string
  mediaType?: string | null
  threadId: string
}) {
  const stub = await getAgentRuntimeStub(input.hostName)
  return disposeRpcResult(
    await stub.uploadThreadDocument(input.threadId, {
      base64: input.base64,
      filename: input.filename,
      mediaType: input.mediaType ?? null,
    }),
  )
}

export async function readChatThreadDocumentBytes(input: {
  documentId: string
  hostName: string
  threadId: string
}) {
  const stub = await getAgentRuntimeStub(input.hostName)
  return disposeRpcResult(
    await stub.readThreadDocumentBytes(input.threadId, input.documentId),
  )
}

export async function readChatThreadDocumentVersionBytes(input: {
  documentId: string
  hostName: string
  preferPdf?: boolean
  threadId: string
  versionId?: string | null
}) {
  const stub = await getAgentRuntimeStub(input.hostName)
  return disposeRpcResult(
    await stub.readThreadDocumentVersionBytes(input.threadId, {
      documentId: input.documentId,
      preferPdf: input.preferPdf,
      versionId: input.versionId ?? null,
    }),
  )
}

export async function listChatThreadDocumentVersions(input: {
  documentId: string
  hostName: string
  threadId: string
}) {
  const stub = await getAgentRuntimeStub(input.hostName)
  return disposeRpcResult(
    await stub.listThreadDocumentVersions(input.threadId, input.documentId),
  )
}

export async function resolveChatThreadDocumentEdit(input: {
  action: 'accept' | 'reject'
  documentId: string
  editId: string
  hostName: string
  threadId: string
}) {
  const stub = await getAgentRuntimeStub(input.hostName)
  return disposeRpcResult(
    await stub.resolveThreadDocumentEdit(input.threadId, {
      action: input.action,
      documentId: input.documentId,
      editId: input.editId,
    }),
  )
}
