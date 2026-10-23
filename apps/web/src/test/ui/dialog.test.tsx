import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@garden/ui/components/ui/dialog'

function renderDialog(className?: string) {
  render(
    <Dialog open>
      <DialogContent className={className}>
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
})
