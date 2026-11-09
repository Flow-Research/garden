import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ComposerToolsMenu } from './composer-tools-menu'

const base = {
  presetId: 'default' as const,
  onPresetChange: vi.fn(),
}

describe('ComposerToolsMenu', () => {
  it('shows the selected preset label on the trigger', () => {
    render(<ComposerToolsMenu {...base} presetId="org-brain" />)
    expect(screen.getByRole('button', { name: /tools/i })).toHaveTextContent(
      'Org. Brain',
    )
  })

  it('lists all six presets in design order', async () => {
    render(<ComposerToolsMenu {...base} />)
    await userEvent.click(screen.getByRole('button', { name: /tools/i }))
    // Base UI's Menu mounts/positions its popup asynchronously (floating-ui
    // computes placement off the microtask queue), so the radio items are
    // not present in the DOM the instant the click handler returns —
    // findAllByRole polls until they appear instead of asserting
    // synchronously.
    const items = await screen.findAllByRole('menuitemradio')
    expect(items.map((item) => item.textContent)).toEqual([
      'Default',
      'QA Agent',
      'Engineering Issue Triage',
      'Org. Brain',
      'Research Synthesis',
      'Document Review',
    ])
  })

  it('changes preset on selection', async () => {
    const onPresetChange = vi.fn()
    render(<ComposerToolsMenu {...base} onPresetChange={onPresetChange} />)
    await userEvent.click(screen.getByRole('button', { name: /tools/i }))
    await userEvent.click(
      await screen.findByRole('menuitemradio', { name: /QA Agent/ }),
    )
    expect(onPresetChange).toHaveBeenCalledWith('qa-agent')
  })

  it('does not carry the sources list — that lives in the footer', async () => {
    render(<ComposerToolsMenu {...base} presetId="org-brain" />)
    await userEvent.click(screen.getByRole('button', { name: /tools/i }))
    // Wait for the popup before asserting an absence, otherwise this passes
    // trivially against a popup that has not mounted yet.
    await screen.findByRole('menuitemradio', { name: /Default/ })
    expect(
      screen.queryByRole('menuitem', { name: /connect/i }),
    ).not.toBeInTheDocument()
  })
})
