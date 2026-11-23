import { env, exports } from 'cloudflare:workers'
import { getAgentByName } from 'agents'
import { beforeAll, expect, it, vi } from 'vitest'

declare const __CHUNKS__: number

const expected = Array.from(
  { length: __CHUNKS__ },
  (_, index) => `<${index}>`,
).join('')

function collectText(socket: WebSocket) {
  const state = { text: '', frames: 0 }
  socket.addEventListener('message', (event) => {
    const frame = JSON.parse(String(event.data))
    if (frame.type !== 'cf_agent_use_chat_response' || !frame.body) return
    const body = JSON.parse(frame.body)
    if (body.type !== 'text-delta') return
    state.frames += 1
    state.text += body.delta
  })
  return state
}

async function runTurn(name: string, withViewer: boolean) {
  const root = await getAgentByName(env.RootAgent, name)
  let viewer: ReturnType<typeof collectText> | undefined
  if (withViewer) {
    const response = await exports.default.fetch(
      `http://h/agents/root-agent/${name}/sub/run-facet/run-1`,
      { headers: { Upgrade: 'websocket' } },
    )
    const socket = response.webSocket
    if (!socket) throw new Error(`viewer upgrade failed: ${response.status}`)
    socket.accept()
    viewer = collectText(socket)
    await root.status('none')
  }
  const { instance } = await root.resetCounts()
  const startedAt = Date.now()
  await root.start('turn-1')
  await vi.waitFor(
    async () => expect(await root.status('turn-1')).toBe('completed'),
    { timeout: 1_700_000, interval: 100 },
  )
  if (viewer) {
    let seen = viewer.text.length
    let lastProgress = Date.now()
    while (
      viewer.text.length < expected.length &&
      Date.now() - lastProgress < 60_000
    ) {
      // Polling keeps the root resident; eviction would zero its counters.
      await root.readCounts()
      await new Promise((resolve) => setTimeout(resolve, 200))
      if (viewer.text.length > seen) {
        seen = viewer.text.length
        lastProgress = Date.now()
      }
    }
  }
  const counts = await root.readCounts()
  expect(counts.instance).toBe(instance)
  const result = {
    viewers: withViewer ? 1 : 0,
    chunks: __CHUNKS__,
    ...counts,
    rootRpc: counts.setName + counts.broadcast,
    viewerFrames: viewer?.frames ?? null,
    inOrder: viewer ? viewer.text === expected : null,
    ms: Date.now() - startedAt,
  }
  console.log(`RESULT ${JSON.stringify(result)}`)
  if (viewer) expect(viewer.text).toBe(expected)
}

// The pool transforms the SDK lazily on first facet load, which takes minutes.
beforeAll(async () => {
  const warm = await getAgentByName(env.RootAgent, 'warm')
  await warm.status('none')
}, 600_000)

it('zero viewers', () => runTurn('zero', false))
it('one viewer', () => runTurn('one', true))
