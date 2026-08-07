import {
  DocumentOperationOutcome,
  DocumentSnapshot,
} from '@garden/agent-runtime/src/documents/document-artifact-model'
import { SkillOperationError } from '@garden/core/skills'
import { Context, Effect, Layer } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { DocumentArtifacts } from './document-artifacts-service'
import { ExecutorConnectors } from './executor-connectors-service'
import { gardenApiWebHandler } from './garden-api.server'
import { makeDeferredSkillsService } from './skills-api.server'
import { Skills, type SkillsService } from './skills-service'

vi.mock('./chat-agents', () => ({
  applyChatThreadDocumentArtifactOperation: vi.fn(),
  readChatThreadDocumentArtifact: vi.fn(),
}))

const snapshot = DocumentSnapshot.make({
  revision: 1,
  title: 'Draft',
  blocks: [],
  lastModified: 1,
})
const DOCUMENT_ID = 'c482d5b3-9f1a-4f20-8c24-1c7d9c7507fd'
const documentArtifacts = DocumentArtifacts.of({
  get: () => Effect.succeed(snapshot),
  apply: () =>
    Effect.succeed(DocumentOperationOutcome.cases.Unchanged.make({ snapshot })),
})
const executorConnectors = ExecutorConnectors.of({
  listTools: () => Effect.succeed([]),
})

/** Supplies all shared API services without acquiring external resources. */
const apiContext = (skills: SkillsService, connectors = executorConnectors) =>
  Context.add(
    Context.merge(
      Context.make(Skills, skills),
      Context.make(DocumentArtifacts, documentArtifacts),
    ),
    ExecutorConnectors,
    connectors,
  )

/** Provides a complete facade while keeping this routing test focused on list. */
function listSkillsService(): SkillsService {
  const unused = () => Effect.die('Unexpected Skills operation')
  return {
    list: () => Effect.succeed([]),
    get: unused,
    create: unused,
    update: unused,
    remove: unused,
    import: unused,
    search: unused,
    preview: unused,
    listAgentAssignments: unused,
    setAgentAssignments: unused,
  }
}

describe('combined Garden Effect HttpApi', () => {
  it('serves and decodes document routes without acquiring Skills infrastructure', async () => {
    const acquireSkills = vi.fn()
    const rejectingSkillsDatabaseLayer = Layer.effect(
      Skills,
      Effect.gen(function* () {
        acquireSkills()
        return yield* new SkillOperationError({
          operation: 'open request database',
          message: 'Failed to open the request database.',
          cause: new Error('db unavailable'),
        })
      }),
    )
    const context = apiContext(
      makeDeferredSkillsService(rejectingSkillsDatabaseLayer),
    )

    const found = await gardenApiWebHandler(
      new Request(
        `https://garden.example/api/documents/${DOCUMENT_ID}/artifact`,
      ),
      context,
    )
    const invalid = await gardenApiWebHandler(
      new Request('https://garden.example/api/documents/not-a-uuid/artifact'),
      context,
    )
    const unknown = await gardenApiWebHandler(
      new Request('https://garden.example/api/unknown', { method: 'OPTIONS' }),
      context,
    )

    expect(found.status).toBe(200)
    await expect(found.json()).resolves.toEqual(snapshot)
    expect(invalid.status).toBe(400)
    expect(unknown.status).toBe(404)
    expect(acquireSkills).not.toHaveBeenCalled()
  })

  it('acquires Skills infrastructure when a Skills endpoint executes', async () => {
    const acquireSkills = vi.fn()
    const skillsLayer = Layer.sync(Skills, () => {
      acquireSkills()
      return listSkillsService()
    })
    const context = apiContext(makeDeferredSkillsService(skillsLayer))

    const response = await gardenApiWebHandler(
      new Request('https://garden.example/api/skills'),
      context,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([])
    expect(acquireSkills).toHaveBeenCalledOnce()
  })

  it('routes the Executor catalog through the shared Effect API', async () => {
    const listTools = vi.fn(() =>
      Effect.succeed([
        {
          address: 'calendar.events.list',
          name: 'list',
          description: 'List calendar events',
          integration: 'calendar',
          connection: 'default',
          owner: 'user' as const,
          requiresApproval: false,
          mayElicit: false,
        },
      ]),
    )
    const context = apiContext(
      listSkillsService(),
      ExecutorConnectors.of({ listTools }),
    )

    const response = await gardenApiWebHandler(
      new Request('https://garden.example/api/executor/tools?limit=10'),
      context,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject([
      { address: 'calendar.events.list' },
    ])
    expect(listTools).toHaveBeenCalledWith({ limit: 10 })
  })
})
