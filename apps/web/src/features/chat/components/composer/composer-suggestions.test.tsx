import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ComposerSuggestions } from './composer-suggestions'
import { SUGGESTION_PILLS } from './composer-tools'

describe('ComposerSuggestions', () => {
  it('renders the header and all pills', () => {
    render(<ComposerSuggestions onSelect={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getByText('Jump right in')).toBeInTheDocument()
    for (const pill of SUGGESTION_PILLS) {
      expect(
        screen.getByRole('button', { name: pill.label }),
      ).toBeInTheDocument()
    }
  })

  it('calls onSelect with the pill starter', async () => {
    const onSelect = vi.fn()
    render(<ComposerSuggestions onSelect={onSelect} onDismiss={vi.fn()} />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Draft a document' }),
    )
    expect(onSelect).toHaveBeenCalledWith('Help me draft a document about ')
  })

  it('calls onDismiss when the close button is clicked', async () => {
    const onDismiss = vi.fn()
    render(<ComposerSuggestions onSelect={vi.fn()} onDismiss={onDismiss} />)
    await userEvent.click(
      screen.getByRole('button', { name: /dismiss suggestions/i }),
    )
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
