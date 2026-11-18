import { fireEvent, render, screen } from '@testing-library/react'
import { Schema } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import {
  ExecutorIntegrationItem,
  ExecutorRegistryEntry,
} from '@/lib/executor-contract'
import { ManageDrawerBody } from './manage-drawer-body'

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: { tools: [], message: 'Connect to load tools.' },
    isFetching: false,
  }),
}))
vi.mock('@garden/ui/components/ui/drawer', () => ({
  DrawerHeader: 'header',
  DrawerDescription: 'p',
  DrawerTitle: 'h2',
}))

const entry = Schema.decodeUnknownSync(ExecutorRegistryEntry)({
  providerId: 'executor:workstream',
  name: 'Workstream',
  description: 'Governed work',
  domain: 'workstream.flowresearch.tech',
  categories: [],
  sources: ['mcp'],
})
const integration = Schema.decodeUnknownSync(ExecutorIntegrationItem)({
  providerId: entry.providerId,
  slug: 'workstream',
  label: 'Workstream',
  description: entry.description,
  protocol: 'mcp',
  status: 'setup_required',
  canRemove: false,
  canRefresh: true,
  authMethods: [
    {
      kind: 'oauth',
      id: 'oauth2',
      template: 'oauth2',
      label: 'OAuth',
      scopes: [],
    },
  ],
  connections: [],
  tools: [],
})

const renderConnection = (owner: 'user' | 'org') => {
  const onOAuth = vi.fn()
  render(
    <ManageDrawerBody
      entry={entry}
      integration={integration}
      providerIntegrations={[integration]}
      owner={owner}
      pending={false}
      onConnect={vi.fn()}
      onOAuth={onOAuth}
      onConnected={async () => {}}
      onManageSource={vi.fn()}
      onInstall={vi.fn()}
      onAction={vi.fn(async () => {})}
      onClose={vi.fn()}
    />,
  )
  return onOAuth
}

describe('Workstream connection ownership', () => {
  it('explains the Personal requirement without offering Workspace authorization', () => {
    const onOAuth = renderConnection('org')
    expect(
      screen.getByText(/Workstream requires a Personal connection/),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Authorize Workstream' }),
    ).toBeNull()
    expect(onOAuth).not.toHaveBeenCalled()
  })

  it('offers the existing authorization action in Personal scope', () => {
    const onOAuth = renderConnection('user')
    fireEvent.click(
      screen.getByRole('button', { name: 'Authorize Workstream' }),
    )
    expect(onOAuth).toHaveBeenCalledWith(
      '/api/executor/oauth/start?integration=workstream&owner=user',
    )
  })
})
