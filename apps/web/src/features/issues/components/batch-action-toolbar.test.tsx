import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useIssueSelectionStore } from '@garden/app-state/issues/stores/selection-store'
import { BatchActionToolbar } from './batch-action-toolbar'

const mocks = vi.hoisted(() => ({
  deleteIssues: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/lib/issues/mutations', () => ({
  useBatchUpdateIssues: () => ({ mutate: vi.fn(), isPending: false }),
  useBatchDeleteIssues: () => ({
    mutateAsync: mocks.deleteIssues,
    isPending: false,
  }),
}))
vi.mock('./pickers', () => ({
  AssigneePicker: () => null,
  PriorityPicker: () => null,
  StatusPicker: () => null,
}))
vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}))

describe('BatchActionToolbar delete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    act(() => {
      useIssueSelectionStore.getState().clear()
      useIssueSelectionStore.getState().toggle('issue-1')
      useIssueSelectionStore.getState().toggle('issue-2')
    })
  })

  it('deletes once and reports success when confirm is clicked twice', async () => {
    let finish: () => void = () => {}
    mocks.deleteIssues.mockImplementation(
      () => new Promise<void>((resolve) => (finish = resolve)),
    )
    render(<BatchActionToolbar />)

    fireEvent.click(screen.getByRole('button', { name: /delete/i }))
    const confirm = await screen.findByRole('button', { name: 'Delete' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    await act(async () => finish())

    expect(mocks.deleteIssues).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Deleted 2 issues'),
    )
    expect(mocks.toastError).not.toHaveBeenCalled()
  })
})
