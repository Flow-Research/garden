import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, ApiTransport } from '@/lib/api'
import {
  executionHostReadFailure,
  getExecutionHostRun,
  listExecutionHosts,
} from './api'
import {
  HOST_ID,
  LAUNCH_ID,
  OTHER_WORKSPACE_ID,
  WORKSPACE_ID,
  hostDirectory,
  hostEvent,
  hostSnapshot,
  hostSummary,
} from './test-fixtures'

const state = vi.hoisted(() => ({
  transport: null as unknown,
  unauthorized: vi.fn(),
}))
vi.mock('@/lib/api', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  getApiTransport: () => state.transport,
}))

const fetchMock = vi.fn<typeof fetch>()

function answer(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(Response.json(body, { status }))
}

function lastRequest() {
  const call = fetchMock.mock.calls.at(-1)
  if (!call) throw new Error('Expected a request')
  return { url: String(call[0]), headers: new Headers(call[1]?.headers) }
}

describe('execution-host reads', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    state.unauthorized.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    const transport = new ApiTransport('http://garden.test', {
      onUnauthorized: state.unauthorized,
    })
    // The active workspace differs so the test proves the explicit scope wins.
    transport.setWorkspaceId(OTHER_WORKSPACE_ID)
    state.transport = transport
  })

  it('reads the directory of the named workspace and follows the host cursor', async () => {
    answer(hostDirectory([hostSummary()], { nextHostId: HOST_ID }))
    const page = await listExecutionHosts(WORKSPACE_ID)
    expect(lastRequest().url).toBe('http://garden.test/api/execution-hosts/')
    expect(lastRequest().headers.get('X-Workspace-ID')).toBe(WORKSPACE_ID)
    expect(page.hosts.map((host) => host.hostId)).toEqual([HOST_ID])
    expect(page.receivedAt).toBeGreaterThan(0)

    answer(hostDirectory([]))
    await listExecutionHosts(WORKSPACE_ID, HOST_ID)
    expect(lastRequest().url).toBe(
      `http://garden.test/api/execution-hosts/?afterHostId=${HOST_ID}`,
    )
  })

  it('rejects a directory or snapshot that belongs to another workspace', async () => {
    answer(
      hostDirectory([hostSummary({ workspaceId: OTHER_WORKSPACE_ID })], {
        workspaceId: OTHER_WORKSPACE_ID,
      }),
    )
    await expect(listExecutionHosts(WORKSPACE_ID)).rejects.toBeInstanceOf(
      ApiError,
    )
    answer(hostDirectory([hostSummary({ workspaceId: OTHER_WORKSPACE_ID })]))
    await expect(listExecutionHosts(WORKSPACE_ID)).rejects.toThrow(
      'Host directory workspace differs',
    )
    answer(hostSnapshot([hostEvent(1)]))
    await expect(
      getExecutionHostRun(
        WORKSPACE_ID,
        '77777777-7777-4777-8777-777777777777',
        0,
      ),
    ).rejects.toBeInstanceOf(ApiError)
  })

  it('reads a run page after the given cursor', async () => {
    answer(hostSnapshot([hostEvent(3)], { lastSequence: 3, nextCursor: 3 }))
    const page = await getExecutionHostRun(WORKSPACE_ID, LAUNCH_ID, 2)
    expect(lastRequest().url).toBe(
      `http://garden.test/api/execution-hosts/runs/${LAUNCH_ID}/?after=2`,
    )
    expect(lastRequest().headers.get('X-Workspace-ID')).toBe(WORKSPACE_ID)
    expect(page.events.map((event) => event.sequence)).toEqual([3])
  })

  it('classifies each refusal of the existing guard', async () => {
    const failure = async (body: unknown, status: number) => {
      answer(body, status)
      return executionHostReadFailure(
        await listExecutionHosts(WORKSPACE_ID).catch((error: unknown) => error),
      )
    }
    expect(
      await failure({ error: 'The engineering pilot is not configured' }, 503),
    ).toBe('disabled')
    expect(
      await failure({ error: 'Session verification is unavailable' }, 503),
    ).toBe('unavailable')
    expect(
      await failure({ error: 'This operator is outside the pilot' }, 403),
    ).toBe('refused')
    expect(await failure({ error: 'Launch not found' }, 404)).toBe('not_found')
    expect(state.unauthorized).not.toHaveBeenCalled()
    expect(await failure({ error: 'Unauthorized' }, 401)).toBe('signed_out')
    expect(state.unauthorized).toHaveBeenCalledTimes(1)
    expect(executionHostReadFailure(new Error('offline'))).toBe('unavailable')
  })
})
