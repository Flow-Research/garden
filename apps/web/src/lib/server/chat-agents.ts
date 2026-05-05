import { and, eq } from 'drizzle-orm'
import {
  bindExistingCapabilitiesToAgent,
  bindExistingSkillsToAgent,
} from './agent-bindings'
import { getAgentDoStub } from './agent-do-router'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import { DEFAULT_AGENT_PERMISSIONS } from '@garden/core/agents/permissions'

// Server-side helpers for managing AgentDOs + their ChatSubAgent thread
// facets. The API response exposes `hostName`, the saved AgentDO runtime name.
// New agents use their UUID; migrated chat agents may keep the older runtime
// name that owns their Durable Object storage.

function getAgentRuntimeStub(agentId: string) {
  const stubResult = getAgentDoStub(appEnv, agentId)
  if (stubResult.isErr()) throw stubResult.error
  return stubResult.value
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
    await bindExistingSkillsToAgent({
      db,
      schema,
      agentId: existingAgent.id,
      workspaceId: input.workspaceId,
    })
    await bindExistingCapabilitiesToAgent({
      db,
      schema,
      agentId: existingAgent.id,
      grantedBy: input.ownerUserId,
    })
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
  const stub = getAgentRuntimeStub(input.hostName)
  await stub.ensureThread(input.threadId)
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
  const stub = getAgentRuntimeStub(input.hostName)
  await stub.deleteThread(input.threadId)
}

export async function pauseChatThreadAgent(input: {
  threadId: string
  hostName: string
}) {
  const stub = getAgentRuntimeStub(input.hostName)
  await stub.pauseThread(input.threadId)
}

export async function refreshChatThreadSkillInventory(input: {
  threadId: string
  hostName: string
}) {
  const stub = getAgentRuntimeStub(input.hostName)
  await stub.refreshThreadSkills(input.threadId)
}

export async function refreshChatThreadPromptConfig(input: {
  threadId: string
  hostName: string
}) {
  const stub = getAgentRuntimeStub(input.hostName)
  await stub.refreshThreadPrompt(input.threadId)
}

export async function debugChatThreadMeta(input: {
  threadId: string
  hostName: string
}) {
  const stub = getAgentRuntimeStub(input.hostName)
  return stub.debugThreadMeta(input.threadId)
}

export async function debugChatThreadWorkspace(input: {
  threadId: string
  hostName: string
}) {
  const stub = getAgentRuntimeStub(input.hostName)
  return stub.debugThreadWorkspace(input.threadId)
}

export async function debugChatThreadSandbox(input: {
  threadId: string
  hostName: string
}) {
  const stub = getAgentRuntimeStub(input.hostName)
  return stub.debugThreadSandbox(input.threadId)
}

export async function debugChatThreadTools(input: {
  threadId: string
  hostName: string
}) {
  const stub = getAgentRuntimeStub(input.hostName)
  return stub.debugThreadTools(input.threadId)
}

export async function debugChatThreadPrompt(input: {
  threadId: string
  hostName: string
}) {
  const stub = getAgentRuntimeStub(input.hostName)
  return stub.debugThreadPrompt(input.threadId)
}

export async function uploadChatThreadDocument(input: {
  base64: string
  filename: string
  hostName: string
  mediaType?: string | null
  threadId: string
}) {
  const stub = getAgentRuntimeStub(input.hostName)
  return stub.uploadThreadDocument(input.threadId, {
    base64: input.base64,
    filename: input.filename,
    mediaType: input.mediaType ?? null,
  })
}

export async function readChatThreadDocumentBytes(input: {
  documentId: string
  hostName: string
  threadId: string
}) {
  const stub = getAgentRuntimeStub(input.hostName)
  return stub.readThreadDocumentBytes(input.threadId, input.documentId)
}

export async function readChatThreadDocumentVersionBytes(input: {
  documentId: string
  hostName: string
  preferPdf?: boolean
  threadId: string
  versionId?: string | null
}) {
  const stub = getAgentRuntimeStub(input.hostName)
  return stub.readThreadDocumentVersionBytes(input.threadId, {
    documentId: input.documentId,
    preferPdf: input.preferPdf,
    versionId: input.versionId ?? null,
  })
}

export async function listChatThreadDocumentVersions(input: {
  documentId: string
  hostName: string
  threadId: string
}) {
  const stub = getAgentRuntimeStub(input.hostName)
  return stub.listThreadDocumentVersions(input.threadId, input.documentId)
}

export async function resolveChatThreadDocumentEdit(input: {
  action: 'accept' | 'reject'
  documentId: string
  editId: string
  hostName: string
  threadId: string
}) {
  const stub = getAgentRuntimeStub(input.hostName)
  return stub.resolveThreadDocumentEdit(input.threadId, {
    action: input.action,
    documentId: input.documentId,
    editId: input.editId,
  })
}
