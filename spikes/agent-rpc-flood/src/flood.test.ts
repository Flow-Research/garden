import { env, exports } from 'cloudflare:workers'
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
  const root = env.RootAgent.get(env.RootAgent.idFromName(name))
  await root.setName(name)
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
  await root.resetCounts()
  const startedAt = Date.now()
  await root.start('turn-1')
  await vi.waitFor(
    async () => expect(await root.status('turn-1')).toBe('completed'),
    { timeout: 280_000, interval: 100 },
  )
  if (viewer) {
    const connected = viewer
    await vi.waitFor(
      () => expect(connected.text.length).toBe(expected.length),
      { timeout: 30_000, interval: 50 },
    )
  }
  const counts = await root.readCounts()
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
  const warm = env.RootAgent.get(env.RootAgent.idFromName('warm'))
  await warm.setName('warm')
  await warm.status('none')
}, 600_000)

it('zero viewers', () => runTurn('zero', false))
it('one viewer', () => runTurn('one', true))
