import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { MailAgentPane } from './mail-agent-pane'

describe('MailAgentPane', () => {
  beforeEach(() => window.localStorage.clear())

  it('resizes from its left edge and remembers the chosen width', () => {
    const { rerender } = render(
      <div>
        <MailAgentPane>Agent chat</MailAgentPane>
      </div>,
    )
    const pane = screen.getByRole('complementary', { name: 'Email agent' })
    Object.defineProperty(pane.parentElement, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: 1_200 }),
    })
    const separator = screen.getByRole('separator', {
      name: 'Resize agent panel',
    })

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 800 })
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 680 })
    fireEvent.pointerUp(separator, { pointerId: 1, clientX: 680 })

    expect(pane).toHaveStyle({ width: '500px' })
    expect(window.localStorage.getItem('garden:mail-agent-pane-width')).toBe(
      '500',
    )

    rerender(
      <div>
        <MailAgentPane>Agent chat</MailAgentPane>
      </div>,
    )
    expect(
      screen.getByRole('complementary', { name: 'Email agent' }),
    ).toHaveStyle({ width: '500px' })
  })

  it('supports keyboard resizing and preserves mail reading space', () => {
    render(
      <div>
        <MailAgentPane>Agent chat</MailAgentPane>
      </div>,
    )
    const pane = screen.getByRole('complementary', { name: 'Email agent' })
    Object.defineProperty(pane.parentElement, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: 700 }),
    })
    const separator = screen.getByRole('separator', {
      name: 'Resize agent panel',
    })

    for (let index = 0; index < 10; index += 1) {
      fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    }

    expect(pane).toHaveStyle({ width: '340px' })
    expect(separator).toHaveAttribute('aria-valuenow', '340')
    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(pane).toHaveStyle({ width: '316px' })
  })
})
