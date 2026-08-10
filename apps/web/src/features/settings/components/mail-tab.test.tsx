import { Result } from 'better-result'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ActiveMailSettingsController,
  MailSettingsCommandError,
  MailSettingsCommandOutcome,
} from '../mail-settings-controller'
import { MailTab } from './mail-tab'
import { SettingsPage } from './settings-page'

const getSettings = vi.hoisted(() => vi.fn())
const registerDomainServer = vi.hoisted(() => vi.fn())

vi.mock('../mail-settings.queries', () => ({
  mailSettingsKeys: {
    all: (workspaceId: string) => ['garden-mail-settings', workspaceId],
  },
  mailSettingsOptions: (workspaceId: string) => ({
    queryKey: ['garden-mail-settings', workspaceId, 'snapshot'],
    queryFn: () => getSettings(workspaceId),
    staleTime: 10_000,
  }),
  registerDomain: registerDomainServer,
  refreshDomain: vi.fn(),
  createMailbox: vi.fn(),
  createAddress: vi.fn(),
  setAccess: vi.fn(),
  removeAccess: vi.fn(),
}))

vi.mock('@tanstack/react-start', () => ({
  useServerFn: (serverFunction: unknown) => serverFunction,
}))

vi.mock('@garden/app-state/hooks', () => ({
  useWorkspaceId: () => 'workspace-1',
}))

vi.mock('@garden/app-state/workspace', () => ({
  useWorkspaceStore: (
    selector: (state: { workspace: { name: string } }) => unknown,
  ) => selector({ workspace: { name: 'Acme' } }),
}))

vi.mock('./account-tab', () => ({ AccountTab: () => null }))
vi.mock('./appearance-tab', () => ({ AppearanceTab: () => null }))
vi.mock('./developer-tab', () => ({ DeveloperTab: () => null }))
vi.mock('./workspace-tab', () => ({ WorkspaceTab: () => null }))
vi.mock('./members-tab', () => ({ MembersTab: () => null }))

function commandSuccess(outcome: MailSettingsCommandOutcome) {
  return Promise.resolve(
    Result.ok<MailSettingsCommandOutcome, MailSettingsCommandError>(outcome),
  )
}

function readyController(
  overrides: Partial<ActiveMailSettingsController> = {},
): ActiveMailSettingsController {
  return {
    status: 'ready',
    canManage: true,
    domains: [],
    mailboxes: [],
    actors: [],
    pendingAction: null,
    actions: {
      registerDomain: vi.fn((input) =>
        commandSuccess({ kind: 'domain_registered', domainId: input.name }),
      ),
      refreshDomain: vi.fn((domainId) =>
        commandSuccess({ kind: 'domain_refreshed', domainId }),
      ),
      createMailbox: vi.fn((input) =>
        commandSuccess({ kind: 'mailbox_created', mailboxId: input.name }),
      ),
      createAddress: vi.fn((input) =>
        commandSuccess({ kind: 'address_created', addressId: input.mailboxId }),
      ),
      setAccess: vi.fn((input) =>
        commandSuccess({ kind: 'access_set', accessId: input.actor.id }),
      ),
      removeAccess: vi.fn((accessId) =>
        commandSuccess({ kind: 'access_removed', accessId }),
      ),
    },
    ...overrides,
  }
}

describe('MailTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSettings.mockResolvedValue({
      canManage: true,
      domains: [],
      mailboxes: [],
      actors: [],
    })
  })

  it('loads the authenticated Query controller when no override is supplied', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <MailTab />
      </QueryClientProvider>,
    )

    expect(screen.getByLabelText('Loading mail settings')).toBeInTheDocument()
    expect(await screen.findByText('Company domains')).toBeInTheDocument()
    expect(getSettings).toHaveBeenCalledWith('workspace-1')
  })

  it('is available as a workspace settings tab', () => {
    render(
      <SettingsPage defaultTab="mail" mailController={{ status: 'loading' }} />,
    )

    expect(screen.getByRole('tab', { name: 'Mail' })).toHaveAttribute(
      'data-active',
    )
    expect(screen.getByLabelText('Loading mail settings')).toBeInTheDocument()
  })

  it('reports an unavailable adapter without manufacturing settings rows', () => {
    render(
      <MailTab
        controller={{
          status: 'unavailable',
          reason: 'Authenticated mail administration is not configured.',
        }}
      />,
    )

    expect(
      screen.getByText('Mail administration is not connected'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Authenticated mail administration is not configured.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('example.com')).not.toBeInTheDocument()
  })

  it('keeps provider authority out of managed-domain onboarding', async () => {
    const controller = readyController()
    render(<MailTab controller={controller} />)

    fireEvent.change(screen.getByLabelText('Domain'), {
      target: { value: 'example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Connect domain' }))

    await waitFor(() =>
      expect(controller.actions.registerDomain).toHaveBeenCalledWith({
        name: 'example.com',
      }),
    )
  })

  it('renders real mailbox access and creates a mailbox through the adapter', async () => {
    const controller = readyController({
      domains: [
        {
          id: 'domain-1',
          name: 'example.com',
          status: 'active',
          sendingEnabled: true,
          routingEnabled: true,
          catchAllEnabled: true,
          checkedAtLabel: 'a minute ago',
        },
      ],
      actors: [
        {
          type: 'member',
          id: 'member-1',
          name: 'Ada Founder',
          detail: 'ada@example.com',
        },
        {
          type: 'agent',
          id: 'agent-1',
          name: 'Investor Agent',
          detail: 'Research agent',
        },
      ],
      mailboxes: [
        {
          id: 'mailbox-1',
          domainId: 'domain-1',
          name: 'Investor Relations',
          kind: 'shared',
          status: 'active',
          primaryAddress: 'investors@example.com',
          addresses: [
            {
              id: 'address-1',
              address: 'investors@example.com',
              kind: 'primary',
              status: 'active',
            },
          ],
          access: [
            {
              id: 'access-1',
              actor: {
                type: 'member',
                id: 'member-1',
                name: 'Ada Founder',
                detail: 'ada@example.com',
              },
              level: 'owner',
            },
            {
              id: 'access-2',
              actor: {
                type: 'agent',
                id: 'agent-1',
                name: 'Investor Agent',
                detail: 'Research agent',
              },
              level: 'viewer',
            },
          ],
        },
      ],
    })

    render(<MailTab controller={controller} />)

    expect(screen.getByText('Investor Relations')).toBeInTheDocument()
    expect(screen.getByText('Ada Founder')).toBeInTheDocument()
    expect(screen.getByText('Investor Agent')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'New mailbox' }))
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'deals' },
    })
    fireEvent.change(screen.getByLabelText(/Display name/), {
      target: { value: 'Deals' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create mailbox' }))

    await waitFor(() =>
      expect(controller.actions.createMailbox).toHaveBeenCalledWith({
        domainId: 'domain-1',
        name: 'Deals',
        kind: 'shared',
        primaryLocalPart: 'deals',
        owner: { type: 'member', id: 'member-1' },
      }),
    )
  })
})
