import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SurfaceTabs } from '@garden/ui/components/shell/surface-tabs'

describe('SurfaceTabs', () => {
  it('is a nav of buttons that marks the open one, not an unfocusable tablist', () => {
    const onSelect = vi.fn()
    render(
      <SurfaceTabs
        tabs={[
          { id: 'a', title: 'Planning' },
          { id: 'b', title: 'Release' },
        ]}
        activeId="a"
        onSelect={onSelect}
        onClose={vi.fn()}
        onNew={vi.fn()}
        newLabel="New chat"
      />,
    )

    const nav = screen.getByRole('navigation', { name: 'Open tabs' })
    expect(within(nav).queryAllByRole('tab')).toHaveLength(0)
    expect(
      within(nav).getByRole('button', { name: 'Planning' }),
    ).toHaveAttribute('aria-current', 'page')
    const release = within(nav).getByRole('button', { name: 'Release' })
    expect(release).not.toHaveAttribute('aria-current')
    fireEvent.click(release)
    expect(onSelect).toHaveBeenCalledWith('b')
  })
})
