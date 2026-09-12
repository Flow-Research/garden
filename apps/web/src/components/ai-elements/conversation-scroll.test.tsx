import { forwardRef, useImperativeHandle } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'

let mockIsAtEnd = true
let scrollToEndCalls: Array<{ animated: boolean }> = []
let onScrollRef: (() => void) | undefined

const MockLegendList = forwardRef<any, any>(function MockLegendList(
  { data, maintainScrollAtEnd, onScroll },
  ref,
) {
  onScrollRef = onScroll

  useImperativeHandle(ref, () => ({
    getState: () => ({ isAtEnd: mockIsAtEnd }),
    scrollToEnd(opts?: { animated?: boolean }) {
      scrollToEndCalls.push({ animated: opts?.animated ?? true })
    },
  }))

  return (
    <div>
      {data?.map((item: any) => (
        <div key={item.key}>{item.key}</div>
      ))}
    </div>
  )
})

vi.mock('@legendapp/list/react', () => ({
  LegendList: MockLegendList,
}))

const { Conversation } = await import('./conversation')

function flushRAF() {
  return act(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  )
}

function simulateScrollToTop() {
  mockIsAtEnd = false
  act(() => {
    onScrollRef?.()
  })
}

function simulateScrollToBottom() {
  mockIsAtEnd = true
  act(() => {
    onScrollRef?.()
  })
}

describe('Conversation scroll stickiness', () => {
  it('staying at bottom: auto-scrolls during streaming', async () => {
    mockIsAtEnd = true
    scrollToEndCalls = []
    const { rerender, unmount } = render(
      <Conversation
        data={[{ id: 'user-1' }]}
        getItemKey={(item: any) => item.id}
        renderItem={({ item }: { item: any }) => <div>{item.id}</div>}
      />,
    )
    scrollToEndCalls = []

    act(() => {
      rerender(
        <Conversation
          data={[{ id: 'user-1' }, { id: 'pending' }]}
          getItemKey={(item: any) => item.id}
          renderItem={({ item }: { item: any }) => <div>{item.id}</div>}
        />,
      )
    })
    await flushRAF()
    expect(scrollToEndCalls.length).toBe(1)

    scrollToEndCalls = []
    act(() => {
      rerender(
        <Conversation
          data={[
            { id: 'user-1' },
            { id: 'assistant-1', parts: [{ type: 'text', text: 'Hello' }] },
          ]}
          getItemKey={(item: any) => item.id}
          renderItem={({ item }: { item: any }) => <div>{item.id}</div>}
        />,
      )
    })
    await flushRAF()
    expect(scrollToEndCalls.length).toBe(1)

    scrollToEndCalls = []
    act(() => {
      rerender(
        <Conversation
          data={[
            { id: 'user-1' },
            {
              id: 'assistant-1',
              parts: [{ type: 'text', text: 'Hello world this is streaming' }],
            },
          ]}
          getItemKey={(item: any) => item.id}
          renderItem={({ item }: { item: any }) => <div>{item.id}</div>}
        />,
      )
    })
    await flushRAF()
    expect(scrollToEndCalls.length).toBe(1)

    unmount()
  })

  it('scrolling up: position stays during streaming', async () => {
    mockIsAtEnd = true
    scrollToEndCalls = []
    const { rerender, unmount } = render(
      <Conversation
        data={[{ id: 'user-1' }]}
        getItemKey={(item: any) => item.id}
        renderItem={({ item }: { item: any }) => <div>{item.id}</div>}
      />,
    )
    scrollToEndCalls = []

    simulateScrollToTop()

    act(() => {
      rerender(
        <Conversation
          data={[{ id: 'user-1' }, { id: 'pending' }]}
          getItemKey={(item: any) => item.id}
          renderItem={({ item }: { item: any }) => <div>{item.id}</div>}
        />,
      )
    })
    await flushRAF()
    expect(scrollToEndCalls).toEqual([])

    act(() => {
      rerender(
        <Conversation
          data={[
            { id: 'user-1' },
            { id: 'assistant-1', parts: [{ type: 'text', text: 'Hello' }] },
          ]}
          getItemKey={(item: any) => item.id}
          renderItem={({ item }: { item: any }) => <div>{item.id}</div>}
        />,
      )
    })
    await flushRAF()
    expect(scrollToEndCalls).toEqual([])

    act(() => {
      rerender(
        <Conversation
          data={[
            { id: 'user-1' },
            {
              id: 'assistant-1',
              parts: [{ type: 'text', text: 'Hello world this is streaming' }],
            },
          ]}
          getItemKey={(item: any) => item.id}
          renderItem={({ item }: { item: any }) => <div>{item.id}</div>}
        />,
      )
    })
    await flushRAF()
    expect(scrollToEndCalls).toEqual([])

    unmount()
  })

  it('scroll back to bottom re-enables auto-scroll', async () => {
    mockIsAtEnd = true
    scrollToEndCalls = []
    const { rerender, unmount } = render(
      <Conversation
        data={[{ id: 'user-1' }]}
        getItemKey={(item: any) => item.id}
        renderItem={({ item }: { item: any }) => <div>{item.id}</div>}
      />,
    )
    scrollToEndCalls = []

    simulateScrollToTop()

    act(() => {
      rerender(
        <Conversation
          data={[{ id: 'user-1' }, { id: 'pending' }]}
          getItemKey={(item: any) => item.id}
          renderItem={({ item }: { item: any }) => <div>{item.id}</div>}
        />,
      )
    })
    await flushRAF()
    expect(scrollToEndCalls).toEqual([])

    simulateScrollToBottom()

    scrollToEndCalls = []
    act(() => {
      rerender(
        <Conversation
          data={[
            { id: 'user-1' },
            { id: 'assistant-1', parts: [{ type: 'text', text: 'Response' }] },
          ]}
          getItemKey={(item: any) => item.id}
          renderItem={({ item }: { item: any }) => <div>{item.id}</div>}
        />,
      )
    })
    await flushRAF()
    expect(scrollToEndCalls.length).toBe(1)

    unmount()
  })
})
