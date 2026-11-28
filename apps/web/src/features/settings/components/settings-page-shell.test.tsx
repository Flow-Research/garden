import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MotionGlobalConfig } from 'motion/react'
import { beforeAll, describe, expect, it } from 'vitest'
import { SettingsPageShell } from './settings-page-shell'

async function renderSettings(path = '/settings/profile') {
  const root = createRootRoute({ component: Outlet })
  const settings = createRoute({
    getParentRoute: () => root,
    path: 'settings',
    component: () => (
      <SettingsPageShell>
        <Outlet />
      </SettingsPageShell>
    ),
  })
  const routes = ['profile', 'user-management', 'preferences', 'general'].map(
    (section) =>
      createRoute({
        getParentRoute: () => settings,
        path: section,
        component: () => <h2>{section} content</h2>,
      }),
  )
  const history = createMemoryHistory({ initialEntries: [path] })
  const router = createRouter({
    routeTree: root.addChildren([settings.addChildren(routes)]),
    history,
  })
  await router.load()
  render(<RouterProvider router={router} />)
  return { router, history }
}

describe('Settings page shell', () => {
  // Assert the settled state; animation timing is not under test here.
  beforeAll(() => {
    MotionGlobalConfig.skipAnimations = true
  })

  it('opens a section directly and marks its link current', async () => {
    await renderSettings('/settings/preferences')
    expect(
      await screen.findByRole('heading', { name: 'All settings' }),
    ).toBeVisible()
    expect(
      screen.getByRole('heading', { name: 'preferences content' }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'Preferences' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.queryByRole('link', { name: 'Notifications' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Teams' })).toBeNull()
  })

  it('keeps section content and active links in sync with browser history', async () => {
    const { router, history } = await renderSettings()
    fireEvent.click(await screen.findByRole('link', { name: 'General' }))
    expect(
      await screen.findByRole('heading', { name: 'general content' }),
    ).toBeVisible()
    expect(router.state.location.pathname).toBe('/settings/general')
    await act(async () => {
      history.back()
    })
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute(
        'aria-current',
        'page',
      ),
    )
    expect(
      screen.getByRole('heading', { name: 'profile content' }),
    ).toBeVisible()
    await act(async () => {
      history.forward()
    })
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'General' })).toHaveAttribute(
        'aria-current',
        'page',
      ),
    )
    expect(
      screen.getByRole('heading', { name: 'general content' }),
    ).toBeVisible()
  })
})
