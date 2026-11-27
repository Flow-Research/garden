import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDebugStream } from './use-debug-stream'

describe('useDebugStream', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reports a connection that drops mid-stream instead of spinning', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('connection reset'))
      },
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(body, { status: 200 }),
    )

    const { result } = renderHook(() =>
      useDebugStream({
        open: true,
        workspaceId: 'ws-1',
        sessionId: 'session-drop',
      }),
    )

    await waitFor(() => expect(result.current.fatal).toBe('connection reset'))
  })
})
