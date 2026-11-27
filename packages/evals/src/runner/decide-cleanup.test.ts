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
  assert.ok((await cancelTrialAnalyses(api, thread, seen)).isOk())
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
  )
  assert.ok(result.isErr())
  assert.equal(result.error.code, 'trial_cleanup_unconfirmed')
  assert.deepEqual(cancelled, [a])
})

test('one cancellation failure keeps its ID and does not skip other analyses', async () => {
  const { api, cancelled } = fixture(false, true)
  const result = await cancelTrialAnalyses(api, thread, new Map())
  assert.ok(result.isErr())
  assert.equal(result.error.runId, a)
  assert.deepEqual(cancelled.sort(), [a, b].sort())
})
