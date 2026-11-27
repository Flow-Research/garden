import { act, render, screen, waitFor } from '@testing-library/react'
import { MotionGlobalConfig } from 'motion/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Animate } from './animate'

describe('Animate', () => {
  beforeAll(() => {
    MotionGlobalConfig.skipAnimations = true
  })

  it('renders its content while mounted', () => {
    render(<Animate transition="fade-left">Hello</Animate>)
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('renders nothing while not mounted', () => {
    render(<Animate mounted={false}>Hello</Animate>)
    expect(screen.queryByText('Hello')).toBeNull()
  })

  it('removes the content after its exit and reports it', async () => {
    const onExited = vi.fn()
    const { rerender } = render(
      <Animate onExited={onExited} transition="scale">
        Hello
      </Animate>,
    )
    act(() => {
      rerender(
        <Animate mounted={false} onExited={onExited} transition="scale">
          Hello
        </Animate>,
      )
    })
    await waitFor(() => expect(screen.queryByText('Hello')).toBeNull())
    expect(onExited).toHaveBeenCalledTimes(1)
  })
})
