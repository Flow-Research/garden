import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ApiError } from '@/lib/api/errors'
import { TeamRouteError } from './team-route-error'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to?: string }) => (
    <a href={to}>{children}</a>
  ),
}))

describe('TeamRouteError', () => {
  it('explains access failures for 403 and 404', () => {
    render(
      <TeamRouteError
        error={new ApiError({
          message: 'Team access denied',
          status: 403,
          statusText: 'Forbidden',
        })}
        reset={() => {}}
      />,
    )

    expect(screen.getByText('Team unavailable')).toBeInTheDocument()
    expect(
      screen.getByText(/don't have access to it/),
    ).toBeInTheDocument()
  })

  it('shows a generic failure with a retry path otherwise', () => {
    render(<TeamRouteError error={new Error('boom')} reset={() => {}} />)

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})
