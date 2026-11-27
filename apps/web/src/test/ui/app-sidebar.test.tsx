import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AppSidebar } from '@garden/ui/components/shell/app-sidebar'
import { TooltipProvider } from '@garden/ui/components/ui/tooltip'

function Icon({ className }: { className?: string }) {
  return <svg className={className} />
}

function renderSidebar(collapsed: boolean) {
  const onSelect = vi.fn()
  render(
    <TooltipProvider delay={0}>
      <AppSidebar
        header={<span>Header</span>}
        items={[
          { id: 'home', label: 'Home', href: '/home', icon: Icon },
          { id: 'inbox', label: 'Inbox', icon: Icon },
        ]}
        activeId="home"
        onSelect={onSelect}
        collapsed={collapsed}
        userCard={<span>User</span>}
      />
    </TooltipProvider>,
  )
  return { onSelect }
}

/** Base UI omits `role="tooltip"` when jsdom reports a 0-size anchor. */
function tabTooltip() {
  return document.querySelector('[data-slot="tooltip-content"]')
}

describe('AppSidebar collapsed tab names', () => {
  it('shows the tab name on hover and keeps it as the accessible name', async () => {
    const user = userEvent.setup()
    renderSidebar(true)

    const home = screen.getByRole('link', { name: 'Home' })
    expect(home).toHaveAttribute('aria-label', 'Home')
    expect(tabTooltip()).toBeNull()

    await user.hover(home)
    expect(tabTooltip()).toHaveTextContent('Home')

    await user.unhover(home)
    expect(tabTooltip()).toBeNull()

    await user.hover(screen.getByRole('button', { name: 'Inbox' }))
    expect(tabTooltip()).toHaveTextContent('Inbox')
  })

  it('shows the tab name when the collapsed control is focused', async () => {
    const user = userEvent.setup()
    renderSidebar(true)

    await user.tab()
    expect(screen.getByRole('link', { name: 'Home' })).toHaveFocus()
    expect(tabTooltip()).toHaveTextContent('Home')
  })

  it('does not add a tooltip while the label is already visible', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderSidebar(false)

    const home = screen.getByRole('link', { name: 'Home' })
    expect(home).not.toHaveAttribute('aria-label')
    await user.hover(home)
    expect(tabTooltip()).toBeNull()

    await user.click(home)
    expect(onSelect).toHaveBeenCalledWith('home')
  })

  it('still routes a plain click and leaves a modified click to the browser', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderSidebar(true)
    const home = screen.getByRole('link', { name: 'Home' })

    fireEvent.click(home, { metaKey: true })
    expect(onSelect).not.toHaveBeenCalled()

    await user.click(home)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('home')
  })
})
