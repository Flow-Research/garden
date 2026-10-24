import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@garden/ui/components/ui/dialog'

function renderDialog(className?: string, size?: 'sm' | 'md' | 'lg' | 'xl') {
  render(
    <Dialog open>
      <DialogContent className={className} size={size}>
        <DialogTitle>Title</DialogTitle>
      </DialogContent>
    </Dialog>,
  )
  return screen.getByRole('dialog')
}

describe('DialogContent', () => {
  it('fits the viewport and scrolls, so footers do not clip on short screens', () => {
    const dialog = renderDialog()
    expect(dialog).toHaveClass('max-h-[calc(100dvh-2rem)]', 'overflow-y-auto')
  })

  it('lets a dialog that manages its own height and overflow keep them', () => {
    const dialog = renderDialog('h-[85vh] max-h-[900px] overflow-hidden')
    expect(dialog).toHaveClass('max-h-[900px]', 'overflow-hidden')
    expect(dialog).not.toHaveClass('max-h-[calc(100dvh-2rem)]')
    expect(dialog).not.toHaveClass('overflow-y-auto')
  })

  it('widens by size instead of being capped at the small width', () => {
    expect(renderDialog()).toHaveClass('sm:max-w-sm')
  })

  it('gives a medium dialog 32rem and drops the small cap', () => {
    const dialog = renderDialog(undefined, 'md')
    expect(dialog).toHaveClass('sm:max-w-lg')
    expect(dialog).not.toHaveClass('sm:max-w-sm')
  })
})
