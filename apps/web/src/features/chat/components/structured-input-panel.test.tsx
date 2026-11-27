import { StrictMode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StructuredQuestion } from '@garden/app-state/chat'
import { StructuredInputPanel } from './structured-input-panel'

const QUESTION: StructuredQuestion = {
  id: 'tone',
  question: 'Which tone?',
  options: [{ label: 'Formal' }, { label: 'Casual' }],
}

describe('StructuredInputPanel', () => {
  afterEach(() => vi.useRealTimers())

  it('submits a single-select answer exactly once, even in StrictMode', () => {
    vi.useFakeTimers()
    const onSubmit = vi.fn()
    render(
      <StrictMode>
        <StructuredInputPanel questions={[QUESTION]} onSubmit={onSubmit} />
      </StrictMode>,
    )

    fireEvent.click(screen.getByText('Casual'))
    act(() => vi.advanceTimersByTime(300))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith({ tone: 'Casual' })
  })
})
