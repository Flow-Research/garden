import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InboxComposeDialog } from './inbox-compose-dialog'

const gmail = vi.hoisted(() => ({
  deleteGmailDraft: vi.fn(async (_draftId: string) => undefined),
  getGmailDraft: vi.fn(),
  saveGmailDraft: vi.fn(),
  sendGmail: vi.fn(),
}))
vi.mock('@/lib/api', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  ...gmail,
}))

const DRAFT = {
  draftId: 'draft-1',
  to: ['grace@example.com'],
  cc: [],
  bcc: [],
  subject: 'Hello',
  bodyText: 'Draft body',
}

function renderCompose(draftId: string | null = null) {
  const onOpenChange = vi.fn()
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <InboxComposeDialog open onOpenChange={onOpenChange} draftId={draftId} />
    </QueryClientProvider>,
  )
  return onOpenChange
}

const subject = () => screen.getByPlaceholderText('Add a subject')
const pressEscape = () =>
  fireEvent.keyDown(screen.getAllByRole('dialog')[0] ?? document.body, {
    key: 'Escape',
  })

describe('InboxComposeDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gmail.getGmailDraft.mockResolvedValue(DRAFT)
  })

  it('closes an empty email straight away', async () => {
    const onOpenChange = renderCompose()
    pressEscape()
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('asks before Escape drops a written email, and keeps it on cancel', async () => {
    const onOpenChange = renderCompose()
    fireEvent.change(subject(), { target: { value: 'Quarterly update' } })

    pressEscape()
    const confirm = await screen.findByRole('alertdialog')
    expect(confirm).toHaveTextContent('Discard this email?')
    expect(onOpenChange).not.toHaveBeenCalled()

    fireEvent.click(
      within(confirm).getByRole('button', { name: 'Keep editing' }),
    )
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(subject()).toHaveValue('Quarterly update')

    pressEscape()
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Discard',
      }),
    )
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('asks before the trash button deletes a saved draft', async () => {
    const onOpenChange = renderCompose('draft-1')
    fireEvent.click(
      await screen.findByRole('button', { name: 'Discard email' }),
    )

    const confirm = await screen.findByRole('alertdialog')
    expect(confirm).toHaveTextContent('Delete this draft?')
    expect(gmail.deleteGmailDraft).not.toHaveBeenCalled()

    fireEvent.click(
      within(confirm).getByRole('button', { name: 'Delete draft' }),
    )
    await waitFor(() =>
      expect(gmail.deleteGmailDraft.mock.calls[0]?.[0]).toBe('draft-1'),
    )
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
