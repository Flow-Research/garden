// packages/ui has no DOM test environment, so its ConfirmDialog is covered
// here, where jsdom and Testing Library are already set up.
import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from '@garden/ui/components/common/confirm-dialog'

function Harness({ onConfirm }: { onConfirm: () => Promise<unknown> }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <span>{open ? 'open' : 'closed'}</span>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete team"
        description="This cannot be undone."
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        tone="destructive"
        onConfirm={onConfirm}
      />
    </>
  )
}

function deferred() {
  let resolve: () => void = () => {}
  let reject: (error: Error) => void = () => {}
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('ConfirmDialog', () => {
  it('runs the action once and blocks a second click while pending', async () => {
    const action = deferred()
    const onConfirm = vi.fn(() => action.promise)
    render(<Harness onConfirm={onConfirm} />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const pendingButton = await screen.findByRole('button', {
      name: 'Deleting…',
    })
    expect(pendingButton).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    fireEvent.click(pendingButton)

    expect(onConfirm).toHaveBeenCalledTimes(1)
    action.resolve()
    await waitFor(() => expect(screen.getByText('closed')).toBeTruthy())
  })

  it('stays open and re-enables when the action fails', async () => {
    const action = deferred()
    render(<Harness onConfirm={() => action.promise} />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    action.reject(new Error('nope'))

    const retry = await screen.findByRole('button', { name: 'Delete' })
    expect(retry).not.toBeDisabled()
    expect(screen.getByText('open')).toBeTruthy()
  })
})
