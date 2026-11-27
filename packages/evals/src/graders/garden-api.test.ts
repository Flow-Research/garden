import assert from 'node:assert/strict'
import { it } from 'node:test'
import { evalConfigurationSchema } from '../index.ts'
import { createGardenApiClient } from '../runner/garden-api.ts'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const agentId = '00000000-0000-4000-8000-000000000002'

it('limits authenticated eval targets to local or Garden dev origins', () => {
  for (const baseUrl of [
    'http://localhost:3000/',
    'https://garden-dev.flow-research.workers.dev/',
  ]) {
    assert.equal(
      evalConfigurationSchema.safeParse({
        baseUrl,
        workspaceId,
        agentId,
        deadlineMs: 1000,
        pollIntervalMs: 100,
      }).success,
      true,
    )
  }
  for (const baseUrl of [
    'https://garden-dev.flow-research.workers.dev.evil.test/',
    'https://garden-dev.flow-research.workers.dev/path',
    'http://garden-dev.flow-research.workers.dev/',
    'http://localhost.evil.test/',
  ]) {
    assert.equal(
      evalConfigurationSchema.safeParse({
        baseUrl,
        workspaceId,
        agentId,
        deadlineMs: 1000,
        pollIntervalMs: 100,
      }).success,
      false,
    )
  }
})

it('keeps the session cookie off workbook requests and rejects other hosts', async () => {
  const requests: Array<{ url: string; cookie: string | undefined }> = []
  const client = createGardenApiClient({
    baseUrl: 'http://localhost:3000/',
    sessionCookie: 'session=secret',
    fetch: async (url, init) => {
      requests.push({
        url: String(url),
        cookie: new Headers(init?.headers).get('cookie') ?? undefined,
      })
      return new Response(new Uint8Array([1, 2, 3]))
    },
  })
  const valid = await client.downloadDecideWorkbook({
    url: 'https://api.trydecide.co/uploads/agent-sessions/test/outputs/book.xlsx',
    deadlineAt: Date.now() + 1000,
    runId: agentId,
  })
  assert.equal(valid.isOk(), true)
  assert.deepEqual(requests, [
    {
      url: 'https://api.trydecide.co/uploads/agent-sessions/test/outputs/book.xlsx',
      cookie: undefined,
    },
  ])
  const invalid = await client.downloadDecideWorkbook({
    url: 'https://api.trydecide.co.evil.test/uploads/agent-sessions/test/outputs/book.xlsx',
    deadlineAt: Date.now() + 1000,
    runId: agentId,
  })
  assert.equal(invalid.isErr(), true)
  assert.equal(requests.length, 1)
})

it('rejects a non-eval workspace before a write', async () => {
  const requests: string[] = []
  const client = createGardenApiClient({
    baseUrl: 'http://localhost:3000/',
    sessionCookie: 'session=secret',
    fetch: async (url) => {
      requests.push(String(url))
      return Response.json([{ id: workspaceId, slug: 'personal-workspace' }])
    },
  })
  const result = await client.verifyEvalTarget({
    workspaceId,
    agentId,
    deadlineAt: Date.now() + 1000,
  })
  assert.equal(result.isErr(), true)
  assert.deepEqual(requests, ['http://localhost:3000/api/workspaces'])
})

it('accepts a marked workspace and its active eval agent', async () => {
  const requests: string[] = []
  const client = createGardenApiClient({
    baseUrl: 'http://localhost:3000/',
    sessionCookie: 'session=secret',
    fetch: async (url) => {
      requests.push(String(url))
      return Response.json(
        String(url).includes('/api/agents')
          ? [
              {
                id: agentId,
                workspace_id: workspaceId,
                name: 'Garden Eval Agent',
                record_status: 'active',
              },
            ]
          : [{ id: workspaceId, slug: 'garden-eval-local' }],
      )
    },
  })
  const result = await client.verifyEvalTarget({
    workspaceId,
    agentId,
    deadlineAt: Date.now() + 1000,
  })
  assert.equal(result.isOk(), true)
  assert.deepEqual(requests, [
    'http://localhost:3000/api/workspaces',
    `http://localhost:3000/api/agents?workspace_id=${workspaceId}`,
  ])
})
