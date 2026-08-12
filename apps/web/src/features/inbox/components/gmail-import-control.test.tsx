import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  GmailImportAccountView,
  GmailImportController,
  GmailImportState,
} from '../gmail-import-controller'
import { GmailImportControl } from './gmail-import-control'

const account: GmailImportAccountView = {
  connectionAddress: 'u:user-1/google_gmail/personalGmail',
  identityLabel: 'kixeyems0@gmail.com',
  iconUrl: 'https://example.com/gmail.svg',
  importMode: 'read_only',
}

function controllerFor(
  state: GmailImportState,
  overrides: Partial<GmailImportController> = {},
): GmailImportController {
  return {
    state,
    accounts: state.status === 'disconnected' ? [] : [account],
    selectedConnectionAddress:
      state.status === 'disconnected' ? null : account.connectionAddress,
    gmailIconUrl: account.iconUrl,
    actions: {
      connect: vi.fn(),
      selectAccount: vi.fn(),
      startImport: vi.fn(),
      retryImport: vi.fn(),
      cancelImport: vi.fn(),
      resumeImport: vi.fn(),
    },
    ...overrides,
  }
}

afterEach(cleanup)

describe('GmailImportControl', () => {
  it('connects a personal Google account from the inbox modal', () => {
    const controller = controllerFor({ status: 'disconnected' })
    render(<GmailImportControl controller={controller} />)

    fireEvent.click(screen.getByRole('button', { name: 'Connect Google' }))

    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Connect a personal Gmail account',
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue with Google' }),
    )
    expect(controller.actions.connect).toHaveBeenCalledOnce()
  })

  it('shows the connected identity and keeps the imported mailbox read-only', () => {
    const controller = controllerFor({ status: 'connected' })
    render(<GmailImportControl controller={controller} />)

    fireEvent.click(screen.getByRole('button', { name: 'Import emails' }))

    expect(screen.getByText('kixeyems0@gmail.com')).toBeInTheDocument()
    expect(screen.getByText('Connected · Personal')).toBeInTheDocument()
    expect(screen.getByText(/read-only Garden mailbox/i)).toBeInTheDocument()
    expect(
      screen.getByText(/not appear as a sending address/i),
    ).toBeInTheDocument()
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Import emails' }).at(-1)!,
    )
    expect(controller.actions.startImport).toHaveBeenCalledOnce()
  })

  it('does not claim an exact total while Gmail is still being scanned', () => {
    render(
      <GmailImportControl controller={controllerFor({ status: 'scanning' })} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Scanning Gmail…' }))

    expect(screen.getAllByText('Scanning Gmail…')).toHaveLength(2)
    expect(screen.queryByText(/of .* emails/)).not.toBeInTheDocument()
  })

  it('renders durable server counters during sync', () => {
    const controller = controllerFor({
      status: 'syncing',
      processed: 1_248,
      total: 8_421,
    })
    render(<GmailImportControl controller={controller} />)

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Syncing 1,248 of 8,421 emails',
      }),
    )

    expect(
      screen.getByRole('progressbar', {
        name: 'Syncing 1,248 of 8,421 emails',
      }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }))
    expect(controller.actions.cancelImport).toHaveBeenCalledOnce()
  })

  it('resumes a cancelled run without rescanning its frozen workset', () => {
    const controller = controllerFor({
      status: 'paused',
      processed: 106,
      total: 19_252,
    })
    render(<GmailImportControl controller={controller} />)

    fireEvent.click(screen.getByRole('button', { name: 'Resume import' }))
    expect(screen.getByText(/saved progress/i)).toBeInTheDocument()
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Resume import' }).at(-1)!,
    )
    expect(controller.actions.resumeImport).toHaveBeenCalledOnce()
  })

  it('preserves failed progress and delegates retry', () => {
    const controller = controllerFor({
      status: 'failed',
      processed: 412,
      total: 700,
      message: 'Google temporarily refused the next batch.',
    })
    render(<GmailImportControl controller={controller} />)

    fireEvent.click(screen.getByRole('button', { name: 'Retry import' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      '412 of 700 emails synced',
    )
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Retry import' }).at(-1)!,
    )
    expect(controller.actions.retryImport).toHaveBeenCalledOnce()
  })
})
