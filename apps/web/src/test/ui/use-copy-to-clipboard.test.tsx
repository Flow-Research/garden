import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCopyToClipboard } from '@garden/ui/hooks/use-copy-to-clipboard'

function stubClipboard(writeText: (text: string) => Promise<void>) {
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
}

describe('useCopyToClipboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('shows copied briefly after a successful copy', async () => {
    vi.useFakeTimers()
    stubClipboard(async () => {})
    const { result } = renderHook(() => useCopyToClipboard(1000))

    await act(async () => {
      expect(await result.current.copy('hello')).toBe(true)
    })
    expect(result.current.copied).toBe(true)
    act(() => vi.advanceTimersByTime(1000))
    expect(result.current.copied).toBe(false)
  })

  it('does not claim success, or throw, when the copy fails', async () => {
    stubClipboard(async () => {
      throw new Error('denied')
    })
    const { result } = renderHook(() => useCopyToClipboard())

    await act(async () => {
      expect(await result.current.copy('hello')).toBe(false)
    })
    expect(result.current.copied).toBe(false)
  })
})
