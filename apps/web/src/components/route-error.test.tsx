import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RouteError } from './route-error'

describe('RouteError', () => {
  it('keeps the shell around a page that failed, and retries it', async () => {
    let fail = true
    const page = vi.fn(() => {
      if (fail) throw new Error('page broke')
      return <p>page content</p>
    })
    const root = createRootRoute({
      component: () => (
        <div>
          <nav>sidebar</nav>
          <Outlet />
        </div>
      ),
    })
    const pageRoute = createRoute({
      getParentRoute: () => root,
      path: '/',
      component: page,
    })
    const router = createRouter({
      routeTree: root.addChildren([pageRoute]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
      defaultErrorComponent: RouteError,
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<RouterProvider router={router} />)

    expect(
      await screen.findByText('This page could not be loaded'),
    ).toBeInTheDocument()
    expect(screen.getByText('sidebar')).toBeInTheDocument()

    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('page content')).toBeInTheDocument()
  })
})
