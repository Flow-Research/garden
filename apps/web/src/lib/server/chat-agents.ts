import { and, eq } from 'drizzle-orm'
import {
  bindExistingCapabilitiesToAgent,
  bindExistingSkillsToAgent,
} from './agent-bindings'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'

// Server-side helpers for managing AgentHost DOs + their WorkspaceAgent
// thread facets. The `agent` table row carries the persona/config; the host
// DO runs the runtime; each thread is a facet keyed by threadId.

export function buildAgentHostName(workspaceId: string, userId: string) {
  return `primary.${toBase64Url(workspaceId)}.${toBase64Url(userId)}`
}

function toBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value)
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
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
  const stub = await getAgentHostStub(input.hostName)
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

export async function uploadChatThreadDocument(input: {
  base64: string
  filename: string
  hostName: string
  mediaType?: string | null
  threadId: string
}) {
  const stub = await getAgentHostStub(input.hostName)
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
  const stub = await getAgentHostStub(input.hostName)
  return stub.readThreadDocumentBytes(input.threadId, input.documentId)
}

export async function readChatThreadDocumentVersionBytes(input: {
  documentId: string
  hostName: string
  preferPdf?: boolean
  threadId: string
  versionId?: string | null
}) {
  const stub = await getAgentHostStub(input.hostName)
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
  const stub = await getAgentHostStub(input.hostName)
  return stub.listThreadDocumentVersions(input.threadId, input.documentId)
}

export async function resolveChatThreadDocumentEdit(input: {
  action: 'accept' | 'reject'
  documentId: string
  editId: string
  hostName: string
  threadId: string
}) {
  const stub = await getAgentHostStub(input.hostName)
  return stub.resolveThreadDocumentEdit(input.threadId, {
    action: input.action,
    documentId: input.documentId,
    editId: input.editId,
  })
}
