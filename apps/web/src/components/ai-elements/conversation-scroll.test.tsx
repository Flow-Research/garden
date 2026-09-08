import { forwardRef, useImperativeHandle, useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'

/**
 * Regression tests for chat scroll behavior during agent streaming.
 *
 * The fix binds `maintainScrollAtEnd` to React `isAtBottom` state instead of
 * hardcoded `true`. This prevents auto-scroll from re-engaging when the user
 * scrolls up during streaming — even after content growth brings them back
 * within LegendList's internal threshold.
 *
 * LegendList's internal `isAtEnd` is recomputed on every scroll/layout and is
 * sufficient to stop auto-scroll while the user is away from the end. But with
 * `maintainScrollAtEnd={true}`, auto-scroll re-engages the instant `isAtEnd`
 * flips back to true (content grew past the user's position). The React state
 * acts as a persistent user-intent latch: it only returns true when the user
 * explicitly scrolls to the bottom or clicks "Scroll to bottom".
 */

type MockListHandle = {
  /** Simulate a scroll event. Calls the onScroll prop, which triggers
   *  updateStickiness → reads getState().isAtEnd → sets isAtBottom state. */
  simulateScroll: (isAtEnd: boolean) => void
}

let lastMaintainScrollAtEnd: boolean | undefined
let onScrollRef: (() => void) | undefined

const MockLegendList = forwardRef<MockListHandle, any>(function MockLegendList(
  { data, maintainScrollAtEnd, onScroll },
  ref,
) {
  lastMaintainScrollAtEnd = maintainScrollAtEnd
  onScrollRef = onScroll

  useImperativeHandle(ref, () => ({
    getState: () => ({ isAtEnd: mockGetStateIsAtEnd }),
    simulateScroll(isAtEnd: boolean) {
      mockGetStateIsAtEnd = isAtEnd
      onScroll?.()
    },
  }))

  return (
    <div data-testid="mock-list">
      <div data-testid="maintain-scroll">
        {String(maintainScrollAtEnd)}
      </div>
      {data?.map((item: any) => (
        <div key={item.key}>{item.key}</div>
      ))}
    </div>
  )
})

// Shared state for mock getState().isAtEnd
let mockGetStateIsAtEnd = true

vi.mock('@legendapp/list/react', () => ({
  LegendList: MockLegendList,
}))

const { Conversation } = await import('./conversation')

function renderConversation() {
  const ref = { current: null as unknown as MockListHandle }
  const result = render(
    <Conversation
      data={[{ id: '1' }, { id: '2' }, { id: '3' }]}
      getItemKey={(item: any) => item.id}
      renderItem={({ item }: { item: any }) => <div>{item.id}</div>}
    >
      <span data-testid="children">child content</span>
    </Conversation>,
  )

  // Grab the ref from the mocked LegendList. The component renders
  // <LegendList ref={listRef} ...>, and our mock exposes simulateScroll.
  // We need to extract the ref. Since LegendList is mocked inline and
  // useImperativeHandle binds to the forwarded ref, we can access it
  // through the component's internal ref by rendering a helper.
  //
  // Alternative: we modify the mock to expose the ref globally.
  return { ...result, ref }
}

describe('Conversation scroll stickiness', () => {
  it('starts with maintainScrollAtEnd=true (initial isAtBottom state)', () => {
    mockGetStateIsAtEnd = true
    renderConversation()
    expect(lastMaintainScrollAtEnd).toBe(true)
  })

  it('disables auto-scroll when user scrolls up (isAtEnd becomes false)', () => {
    mockGetStateIsAtEnd = true
    const { unmount } = renderConversation()
    expect(lastMaintainScrollAtEnd).toBe(true)

    // Simulate user scrolling up: LegendList's isAtEnd flips to false.
    // The onScroll callback (updateStickiness) reads getState().isAtEnd
    // and sets React isAtBottom state to false, which feeds maintainScrollAtEnd.
    // This requires two renders: one for the state update, one for the prop.
    // We use act() to flush the state update.
    act(() => {
      mockGetStateIsAtEnd = false
      // Trigger the onScroll callback that updateStickiness wraps.
      // We need to call the mock's simulateScroll, but we don't have the ref.
      // Instead, we access the mock's onScroll callback directly.
      onScrollRef?.()
    })

    // After state update: isAtBottom=false → maintainScrollAtEnd=false
    expect(lastMaintainScrollAtEnd).toBe(false)

    unmount()
  })

  it('re-enables auto-scroll when user scrolls back to bottom', () => {
    mockGetStateIsAtEnd = true
    const { unmount } = renderConversation()

    // Scroll away
    act(() => {
      mockGetStateIsAtEnd = false
      onScrollRef?.()
    })
    expect(lastMaintainScrollAtEnd).toBe(false)

    // Scroll back to bottom
    act(() => {
      mockGetStateIsAtEnd = true
      onScrollRef?.()
    })
    expect(lastMaintainScrollAtEnd).toBe(true)

    unmount()
  })

  it('maintains disabled auto-scroll when streaming adds content while scrolled up', () => {
    mockGetStateIsAtEnd = true
    const { rerender, unmount } = renderConversation()

    // Scroll up
    act(() => {
      mockGetStateIsAtEnd = false
      onScrollRef?.()
    })
    expect(lastMaintainScrollAtEnd).toBe(false)

    // Simulate streaming: data grows but user is still scrolled up.
    // LegendList's isAtEnd stays false because the user hasn't scrolled down.
    // maintainScrollAtEnd should remain false — no auto-scroll.
    mockGetStateIsAtEnd = false
    act(() => {
      rerender(
        <Conversation
          data={[{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }]}
          getItemKey={(item: any) => item.id}
          renderItem={({ item }: { item: any }) => <div>{item.id}</div>}
        >
          <span data-testid="children">child content</span>
        </Conversation>,
      )
    })

    // Data grew but isAtEnd is still false (user scrolled up) → no auto-scroll
    expect(lastMaintainScrollAtEnd).toBe(false)

    unmount()
  })

  it('keeps auto-scroll pinned when at bottom during streaming', () => {
    mockGetStateIsAtEnd = true
    const { rerender, unmount } = renderConversation()
    expect(lastMaintainScrollAtEnd).toBe(true)

    // Simulate streaming while at bottom: data grows, isAtEnd stays true
    mockGetStateIsAtEnd = true
    act(() => {
      rerender(
        <Conversation
          data={[{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }]}
          getItemKey={(item: any) => item.id}
          renderItem={({ item }: { item: any }) => <div>{item.id}</div>}
        >
          <span data-testid="children">child content</span>
        </Conversation>,
      )
    })

    // Still at bottom → maintainScrollAtEnd stays true
    expect(lastMaintainScrollAtEnd).toBe(true)

    unmount()
  })
})
