import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Reasoning, ReasoningContent, ReasoningTrigger } from './reasoning'

function renderReasoning(isStreaming: boolean) {
  return (
    <Reasoning isStreaming={isStreaming}>
      <ReasoningTrigger />
      <ReasoningContent>Weighing the options</ReasoningContent>
    </Reasoning>
  )
}

describe('Reasoning', () => {
  it('stays collapsed when closed while streaming', () => {
    const { rerender } = render(renderReasoning(true))
    const trigger = screen.getByRole('button')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(trigger)
    rerender(renderReasoning(true))

    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens when streaming starts', () => {
    const { rerender } = render(renderReasoning(false))
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
    rerender(renderReasoning(true))
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true')
  })
})
