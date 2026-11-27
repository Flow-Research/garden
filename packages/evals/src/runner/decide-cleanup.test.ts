import assert from 'node:assert/strict'
import test from 'node:test'
import { createGardenApiClient } from './garden-api.ts'
import {
  cancelTrialAnalyses,
  recordDecideRuns,
  type ObservedDecideRuns,
} from './decide-cleanup.ts'

const thread = '9f1b02aa-b355-4f9f-aa19-c1efa506e913'
const a = '410fd52d-80eb-41f5-a838-196eba64d7ce'
const b = '76ddada7-b618-456d-89c3-0050aab4ef17'
const terminal = '4706c48c-0060-479f-89f6-4054e18cf020'

function fixture(listFailed = false, cancelFailed = false) {
  const cancelled: string[] = []
  const api = createGardenApiClient({
    baseUrl: 'http://localhost',
    sessionCookie: 'fixture',
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname
      if (init?.method === 'POST') {
        const id = path.split('/').at(-1)
        assert.ok(id)
        cancelled.push(id)
        return Response.json(
          { status: 'cancel_requested' },
          { status: cancelFailed && id === a ? 500 : 200 },
        )
      }
      assert.ok(path.includes(thread))
      return Response.json(
        {
          runs: [
            { runId: a, status: 'running', files: [] },
            { runId: b, status: 'queued', files: [] },
            { runId: terminal, status: 'completed', files: [] },
          ],
        },
        { status: listFailed ? 500 : 200 },
      )
    },
  })
  return { api, cancelled }
}

test('cleanup cancels each active analysis once and skips completed analyses', async () => {
  const { api, cancelled } = fixture()
  const seen: ObservedDecideRuns = new Map()
  recordDecideRuns(seen, {
    runs: [
      { runId: a, status: 'queued', files: [] },
      { runId: terminal, status: 'running', files: [] },
    ],
  })
  assert.ok((await cancelTrialAnalyses(api, thread, seen, 1000)).isOk())
  assert.deepEqual(cancelled.sort(), [a, b].sort())
})

test('failed listing preserves known IDs and reports incomplete cleanup', async () => {
  const { api, cancelled } = fixture(true)
  const result = await cancelTrialAnalyses(
    api,
    thread,
    new Map([
      [a, 'running'],
      [b, 'cancel_requested'],
    ]),
    1000,
  )
  assert.ok(result.isErr())
  assert.equal(result.error.code, 'trial_cleanup_unconfirmed')
  assert.deepEqual(cancelled, [a])
})

test('one cancellation failure keeps its ID and does not skip other analyses', async () => {
  const { api, cancelled } = fixture(false, true)
  const result = await cancelTrialAnalyses(api, thread, new Map(), 1000)
  assert.ok(result.isErr())
  assert.equal(result.error.runId, a)
  assert.deepEqual(cancelled.sort(), [a, b].sort())
})

test('a disconnected chat reports its original failure and any unconfirmed cleanup', async (t) => {
  const { WebSocketServer } = await import('ws')
  const { once } = await import('node:events')
  const { runChatTask } = await import('./chat-task.ts')
  const { chatEvalTasks, uploadedBriefTask } =
    await import('../examples/chat-tasks.ts')
  const socket = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  t.after(() => new Promise<void>((resolve) => socket.close(() => resolve())))
  await once(socket, 'listening')
  socket.on('connection', (client) => client.close())
  const address = socket.address()
  assert.ok(address && typeof address === 'object')
  const task = chatEvalTasks.get(uploadedBriefTask.taskId)
  assert.ok(task)
  let cleanupThread = ''
  let trialThread = ''
  const result = await runChatTask({
    task,
    config: {
      baseUrl: 'http://127.0.0.1:' + address.port,
      workspaceId: a,
      agentId: b,
      sessionCookie: 'test',
      deadlineMs: 10000,
      pollIntervalMs: 100,
      fetch: async (input, init) => {
        const path = new URL(String(input)).pathname
        if (path === '/api/workspaces')
          return Response.json([{ id: a, slug: 'garden-eval-test' }])
        if (path === '/api/agents')
          return Response.json([
            {
              id: b,
              workspace_id: a,
              name: 'Garden Eval Test',
              record_status: 'active',
            },
          ])
        if (path === '/api/chat/threads') {
          trialThread = JSON.parse(String(init?.body)).id
          return Response.json({
            id: trialThread,
            workspaceId: a,
            agentId: b,
            hostName: 'fixture',
            runtime_key: 'trial',
          })
        }
        if (path.endsWith('/documents'))
          return Response.json({
            ok: true,
            document_id: terminal,
            filename: 'test.txt',
            version_number: 1,
          })
        cleanupThread = path
        return Response.json({}, { status: 503 })
      },
    },
  })
  assert.ok(result.isErr())
  assert.equal(result.error.code, 'chat_socket_closed')
  assert.equal(result.error.threadId, trialThread)
  assert.ok(cleanupThread.includes(trialThread))
  assert.match(result.error.message, /could not list/)
  assert.match(result.error.message, /did not confirm that the chat turn ended/)
})
