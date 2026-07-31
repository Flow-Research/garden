import { render, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MessageResponse } from './message'

const listeners = new Set<() => void>()
let streamedText = ''

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function publish(text: string) {
  streamedText = text
  for (const listener of listeners) listener()
}

function StreamingMessageHarness() {
  const text = useSyncExternalStore(
    subscribe,
    () => streamedText,
    () => '',
  )
  return <MessageResponse>{text}</MessageResponse>
}

describe('MessageResponse streaming', () => {
  afterEach(() => {
    listeners.clear()
    streamedText = ''
    vi.restoreAllMocks()
  })

  it('renders a burst of unanimated Streamdown updates', async () => {
    streamedText = 'Starting'
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<StreamingMessageHarness />)

    expect(() => {
      for (let index = 0; index < 250; index += 1) {
        flushSync(() => publish(`${streamedText} token-${index}`))
      }
    }).not.toThrow()

    await waitFor(() => {
      expect(document.body.textContent).toContain('token-249')
    })
  })
})
