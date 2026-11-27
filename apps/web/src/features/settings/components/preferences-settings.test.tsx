import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDevSettingsStore } from '../dev-settings-store'
import { PreferencesSettings } from './preferences-settings'

const theme = vi.hoisted(() => ({
  current: undefined as string | undefined,
  setTheme: vi.fn(),
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: theme.current, setTheme: theme.setTheme }),
}))

describe('PreferencesSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    theme.current = 'light'
    useDevSettingsStore.setState({ debugMode: false })
  })

  it('shows the current theme on the trigger', () => {
    theme.current = 'dark'
    render(<PreferencesSettings />)
    expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveTextContent(
      'Dark',
    )
  })

  it('shows no theme label before next-themes resolves', () => {
    theme.current = undefined
    render(<PreferencesSettings />)
    const trigger = screen.getByRole('combobox', { name: 'Theme' })
    for (const label of ['Light', 'Dark', 'System']) {
      expect(trigger).not.toHaveTextContent(label)
    }
  })

  it('sets the theme from the dropdown', async () => {
    const user = userEvent.setup()
    render(<PreferencesSettings />)

    await user.click(screen.getByRole('combobox', { name: 'Theme' }))
    await user.click(await screen.findByRole('option', { name: 'System' }))

    expect(theme.setTheme).toHaveBeenCalledWith('system')
  })

  it('toggles debug mode in the dev settings store', async () => {
    const user = userEvent.setup()
    render(<PreferencesSettings />)

    const debugSwitch = screen.getByRole('switch', { name: 'Debug mode' })
    expect(debugSwitch).not.toBeChecked()

    await user.click(debugSwitch)
    expect(useDevSettingsStore.getState().debugMode).toBe(true)
    expect(debugSwitch).toBeChecked()

    await user.click(debugSwitch)
    expect(useDevSettingsStore.getState().debugMode).toBe(false)
  })
})
