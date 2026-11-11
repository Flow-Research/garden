import { QueryClient } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { CoreProvider } from '@garden/app-state/platform/core-provider'
import { useAuthStore } from '@garden/app-state/auth'
import type { User } from '@garden/core/types'
import { expect, it, vi } from 'vitest'
import { api, configureApi } from './index'

vi.mock('@/lib/auth/client', () => ({
  authClient: { organization: { setActive: vi.fn() } },
}))

it('clears private cached reads on account switch and logout, but preserves same-account refresh', () => {
  const queryClient = new QueryClient()
  render(
    <CoreProvider
      api={api}
      configureApi={configureApi}
      queryClient={queryClient}
    >
      <span>Garden</span>
    </CoreProvider>,
  )
  useAuthStore.setState({ user: { id: 'account-a' } as User })
  queryClient.setQueryData(
    ['workspace', 'shared', 'skills'],
    ['private account-a read'],
  )
  useAuthStore.setState({
    user: { id: 'account-a', name: 'Updated profile' } as User,
  })
  expect(queryClient.getQueryData(['workspace', 'shared', 'skills'])).toEqual([
    'private account-a read',
  ])
  useAuthStore.setState({ user: { id: 'account-b' } as User })
  expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
  queryClient.setQueryData(
    ['workspace', 'shared', 'skills'],
    ['private account-b read'],
  )
  useAuthStore.setState({ user: null })
  expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
})
