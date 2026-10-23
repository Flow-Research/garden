import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { IntegrationActionsMenu } from './manage-drawer-body'

function renderMenu() {
  const onAction = vi.fn()
  render(
    <IntegrationActionsMenu
      label="GitHub"
      hasConnections
      canRemove
      pending={false}
      onAction={onAction}
    />,
  )
  return onAction
}

async function choose(item: string) {
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: item }))
}

describe('IntegrationActionsMenu', () => {
  it('resyncs straight away', async () => {
    const onAction = renderMenu()
    await choose('Resync tools')
    expect(onAction).toHaveBeenCalledWith('resync')
  })

  it.each([
    ['Disconnect', 'Disconnect GitHub?', 'Disconnect', 'disconnect'],
    [
      'Delete integration',
      'Delete the GitHub integration?',
      'Delete',
      'delete',
    ],
  ])('%s asks first', async (item, title, confirmLabel, action) => {
    const onAction = renderMenu()
    await choose(item)

    const confirm = await screen.findByRole('alertdialog')
    expect(confirm).toHaveTextContent(title)
    expect(onAction).not.toHaveBeenCalled()

    fireEvent.click(within(confirm).getByRole('button', { name: confirmLabel }))
    expect(onAction).toHaveBeenCalledWith(action)
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })

  it('does nothing when the confirmation is cancelled', async () => {
    const onAction = renderMenu()
    await choose('Delete integration')
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Cancel',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(onAction).not.toHaveBeenCalled()
  })
})
