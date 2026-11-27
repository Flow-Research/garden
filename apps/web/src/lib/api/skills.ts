import { Effect, ManagedRuntime } from 'effect'
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from 'effect/unstable/http'
import { HttpApiClient } from 'effect/unstable/httpapi'
import { SkillUnauthorizedError } from '@garden/core/skills'
import type {
  CreateSkillRequest,
  ImportSkillRequest,
  SetAgentSkillsRequest,
  UpdateSkillRequest,
} from '@garden/core/skills'
import { createRequestId } from '@garden/core/utils'
import { GardenSkillsApi } from './skills-contract'
import { getApiTransport } from './state'
import { createSkillsClient } from './skills-client'
import type { ApiTransport } from './transport'

const runtime = ManagedRuntime.make(FetchHttpClient.layer)
const generatedClients = new WeakMap<
  ApiTransport,
  ReturnType<typeof createGeneratedSkillsClient>
>()
let readClient:
  | {
      transport: ApiTransport
      revision: number
      client: ReturnType<typeof createSkillsClient>
      unsubscribe: () => void
    }
  | undefined

function createGeneratedSkillsClient(transport: ApiTransport) {
  return runtime.runPromise(
    HttpApiClient.make(GardenSkillsApi, {
      baseUrl: transport.getBaseUrl(),
      transformClient: (client) =>
        HttpClient.mapRequest(client, (request) => {
          const workspaceId = transport.getWorkspaceId()
          return HttpClientRequest.setHeaders(request, {
            'X-Request-ID': createRequestId(),
            ...(workspaceId ? { 'X-Workspace-ID': workspaceId } : {}),
          })
        }),
    }),
  )
}

function generatedSkillsClient(transport: ApiTransport) {
  let client = generatedClients.get(transport)
  if (!client) {
    client = createGeneratedSkillsClient(transport)
    generatedClients.set(transport, client)
  }
  return client
}

/** Executes generated-client Effects at TanStack Query's Promise boundary. */
async function runClientEffect<A, E>(
  make: (
    client: Awaited<ReturnType<typeof createGeneratedSkillsClient>>,
  ) => Effect.Effect<A, E>,
  signal?: AbortSignal,
): Promise<A> {
  const transport = getApiTransport()
  const revision = transport.getSessionRevision()
  const client = await generatedSkillsClient(transport)
  const effect = make(client).pipe(
    Effect.tapError((error) =>
      error instanceof SkillUnauthorizedError
        ? Effect.sync(() => {
            if (
              getApiTransport() === transport &&
              transport.getSessionRevision() === revision
            )
              transport.notifyUnauthorized()
          })
        : Effect.void,
    ),
  )
  return runtime.runPromise(effect, { signal })
}

/**
 * Keeps the web consumer on the portable read contract. Session invalidation
 * aborts old reads before a changed account/workspace can consume their results.
 */
export function listSkills(
  params?: { workspace_id?: string },
  signal?: AbortSignal,
) {
  const transport = getApiTransport()
  const workspaceId = transport.getWorkspaceId()
  if (
    !workspaceId ||
    (params?.workspace_id !== undefined && params.workspace_id !== workspaceId)
  ) {
    return Promise.reject(
      new Error('Skills read requires the active workspace'),
    )
  }
  const revision = transport.getSessionRevision()
  if (
    !readClient ||
    readClient.transport !== transport ||
    readClient.revision !== revision
  ) {
    readClient?.client.invalidate()
    readClient?.unsubscribe()
    const client = createSkillsClient({
      origin: new URL(
        transport.getBaseUrl() || '/',
        globalThis.location?.origin,
      ).href,
      workspaceId,
      sessionId: String(revision),
      fetch: (input, init) =>
        globalThis.fetch(input, { ...init, credentials: 'include' }),
      createRequestId,
      onUnauthorized: () => {
        if (
          getApiTransport() === transport &&
          transport.getSessionRevision() === revision
        ) {
          transport.notifyUnauthorized()
        }
      },
    })
    readClient = {
      transport,
      revision,
      client,
      unsubscribe: transport.onSessionInvalidated(() => client.invalidate()),
    }
  }
  return readClient.client.listSkills(signal)
}

export function getSkill(id: string, signal?: AbortSignal) {
  return runClientEffect(
    (client) => client.skills.get({ params: { id } }),
    signal,
  )
}

export function createSkill(data: CreateSkillRequest) {
  return runClientEffect((client) => client.skills.create({ payload: data }))
}

export function updateSkill(id: string, data: UpdateSkillRequest) {
  return runClientEffect((client) =>
    client.skills.update({ params: { id }, payload: data }),
  )
}

export function deleteSkill(id: string) {
  return runClientEffect((client) => client.skills.remove({ params: { id } }))
}

export function importSkill(data: ImportSkillRequest) {
  return runClientEffect((client) => client.skills.import({ payload: data }))
}

export function searchSkills(query: string, limit = 10, signal?: AbortSignal) {
  return runClientEffect(
    (client) => client.skills.search({ query: { q: query, limit } }),
    signal,
  )
}

export function previewSkill(url: string, signal?: AbortSignal) {
  return runClientEffect(
    (client) => client.skills.preview({ payload: { url } }),
    signal,
  )
}

export function listAgentSkills(agentId: string, signal?: AbortSignal) {
  return runClientEffect(
    (client) => client.skills.listAgentAssignments({ params: { id: agentId } }),
    signal,
  )
}

export function setAgentSkills(agentId: string, data: SetAgentSkillsRequest) {
  return runClientEffect((client) =>
    client.skills.setAgentAssignments({
      params: { id: agentId },
      payload: data,
    }),
  )
}
