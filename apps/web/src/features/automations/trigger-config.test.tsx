import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  getDefaultTriggerConfig,
  TriggerConfigSection,
  type TriggerConfig,
} from './trigger-config'

describe('TriggerConfigSection hourly minute', () => {
  it('changes the minute without losing the daily hour', () => {
    const config: TriggerConfig = {
      ...getDefaultTriggerConfig(),
      frequency: 'hourly',
      time: '14:30',
    }
    const onChange = vi.fn()
    render(<TriggerConfigSection config={config} onChange={onChange} />)

    fireEvent.change(screen.getByRole('spinbutton'), {
      target: { value: '45' },
    })

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ time: '14:45' }),
    )
  })
})
