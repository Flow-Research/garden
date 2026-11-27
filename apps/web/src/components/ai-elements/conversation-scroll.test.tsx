import type { ComponentProps } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Conversation } from './conversation'

type Item = { id: string }

type MockRow = {
  key: string
}

type MockListProps = {
  data?: readonly MockRow[]
  maintainScrollAtEnd?: boolean
  onLoad?: (info: { elapsedTimeInMs: number }) => void
  onScroll?: () => void
}

type MockListHandle = {
  getState: () => { isAtEnd: boolean }
  scrollToEnd: (options?: { animated?: boolean }) => void
}

const mockState = vi.hoisted(() => ({
  isAtEnd: true,
  lastMaintainScrollAtEnd: undefined as boolean | undefined,
  onLoad: undefined as MockListProps['onLoad'] | undefined,
  onScroll: undefined as MockListProps['onScroll'] | undefined,
  scrollToEndCalls: [] as Array<{ animated: boolean }>,
}))

vi.mock('@legendapp/list/react', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  /** Exposes LegendList callbacks so the scroll contract can be tested. */
  const MockLegendList = forwardRef<MockListHandle, MockListProps>(
    function MockLegendList(
      { data, maintainScrollAtEnd, onLoad, onScroll },
      ref,
    ) {
      mockState.lastMaintainScrollAtEnd = maintainScrollAtEnd
      mockState.onLoad = onLoad
      mockState.onScroll = onScroll

      useImperativeHandle(ref, () => ({
        getState: () => ({ isAtEnd: mockState.isAtEnd }),
        scrollToEnd: (options) => {
          mockState.scrollToEndCalls.push({
            animated: options?.animated ?? true,
          })
        },
      }))

      return (
        <div>
          {data?.map((item) => (
            <div key={item.key}>{item.key}</div>
          ))}
        </div>
      )
    },
  )

  return { LegendList: MockLegendList }
})

type ConversationEventHandlers = Pick<
  ComponentProps<'div'>,
  'onTouchMove' | 'onTouchStart' | 'onWheel'
>

/** Mounts a small conversation with optional event callbacks for each test. */
function renderConversation(handlers: ConversationEventHandlers = {}) {
  return render(
    <Conversation<Item>
      data={[{ id: 'one' }, { id: 'two' }]}
      getItemKey={(item) => item.id}
      renderItem={({ item }) => <div>{item.id}</div>}
      {...handlers}
    />,
  )
}

/** Sends a synthetic LegendList scroll update to the conversation wrapper. */
function simulateListScroll(isAtEnd: boolean) {
  mockState.isAtEnd = isAtEnd
  act(() => {
    mockState.onScroll?.()
  })
}

describe('Conversation scroll stickiness', () => {
  it('scrolls initially loaded messages to the newest message', () => {
    mockState.isAtEnd = true
    mockState.scrollToEndCalls = []
    renderConversation()

    act(() => {
      mockState.onLoad?.({ elapsedTimeInMs: 0 })
    })

    expect(mockState.scrollToEndCalls).toEqual([{ animated: false }])
  })

  it('keeps maintenance enabled while streaming at the bottom', () => {
    mockState.isAtEnd = true
    mockState.scrollToEndCalls = []
    const { rerender } = renderConversation()

    act(() => {
      rerender(
        <Conversation<Item>
          data={[{ id: 'one' }, { id: 'two' }, { id: 'three' }]}
          getItemKey={(item) => item.id}
          renderItem={({ item }) => <div>{item.id}</div>}
        />,
      )
    })

    expect(mockState.lastMaintainScrollAtEnd).toBe(true)
    expect(mockState.scrollToEndCalls).toEqual([])
  })

  it('disables maintenance while scrolled up and re-enables it at the end', () => {
    mockState.isAtEnd = true
    const { rerender } = renderConversation()
    const log = screen.getByRole('log')

    act(() => {
      fireEvent.wheel(log, { deltaY: -100 })
    })
    simulateListScroll(false)

    expect(mockState.lastMaintainScrollAtEnd).toBe(false)

    act(() => {
      rerender(
        <Conversation<Item>
          data={[{ id: 'one' }, { id: 'two' }, { id: 'three' }]}
          getItemKey={(item) => item.id}
          renderItem={({ item }) => <div>{item.id}</div>}
        />,
      )
    })
    expect(mockState.lastMaintainScrollAtEnd).toBe(false)

    simulateListScroll(true)
    expect(mockState.lastMaintainScrollAtEnd).toBe(true)
  })

  it('tracks upward touch movement and forwards touch callbacks', () => {
    mockState.isAtEnd = true
    const onTouchStart = vi.fn()
    const onTouchMove = vi.fn()
    renderConversation({ onTouchMove, onTouchStart })
    const log = screen.getByRole('log')

    act(() => {
      fireEvent.touchStart(log, { touches: [{ clientY: 100 }] })
      fireEvent.touchMove(log, { touches: [{ clientY: 140 }] })
    })
    simulateListScroll(false)

    expect(mockState.lastMaintainScrollAtEnd).toBe(false)
    expect(onTouchStart).toHaveBeenCalledTimes(1)
    expect(onTouchMove).toHaveBeenCalledTimes(1)
  })
})
