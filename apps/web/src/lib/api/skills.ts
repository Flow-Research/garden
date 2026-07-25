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

const runtime = ManagedRuntime.make(FetchHttpClient.layer)
let clientPromise: ReturnType<typeof createGeneratedSkillsClient> | undefined

function createGeneratedSkillsClient() {
  const transport = getApiTransport()
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

function generatedSkillsClient() {
  clientPromise ??= createGeneratedSkillsClient()
  return clientPromise
}

/** Executes generated-client Effects at TanStack Query's Promise boundary. */
async function runClientEffect<A, E>(
  make: (
    client: Awaited<ReturnType<typeof createGeneratedSkillsClient>>,
  ) => Effect.Effect<A, E>,
  signal?: AbortSignal,
): Promise<A> {
  const client = await generatedSkillsClient()
  const effect = make(client).pipe(
    Effect.tapError((error) =>
      error instanceof SkillUnauthorizedError
        ? Effect.sync(() => getApiTransport().notifyUnauthorized())
        : Effect.void,
    ),
  )
  return runtime.runPromise(effect, { signal })
}

export function listSkills(
  _params?: { workspace_id?: string },
  signal?: AbortSignal,
) {
  return runClientEffect((client) => client.skills.list(), signal)
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
