import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ComposerAddMenu } from './composer-add-menu'

const base = {
  onUploadClick: vi.fn(),
}

describe('ComposerAddMenu', () => {
  it('fires onUploadClick', async () => {
    const onUploadClick = vi.fn()
    render(<ComposerAddMenu {...base} onUploadClick={onUploadClick} />)
    await userEvent.click(screen.getByRole('button', { name: /add files/i }))
    await userEvent.click(
      await screen.findByRole('menuitem', { name: /upload files/i }),
    )
    expect(onUploadClick).toHaveBeenCalled()
  })

  it('shows Add from Drive as a visual-only menu item', async () => {
    render(<ComposerAddMenu {...base} />)
    await userEvent.click(screen.getByRole('button', { name: /add files/i }))
    expect(
      await screen.findByRole('menuitem', { name: /add from drive/i }),
    ).toBeInTheDocument()
    expect(screen.queryAllByRole('menuitem')).toHaveLength(2)
  })
})
