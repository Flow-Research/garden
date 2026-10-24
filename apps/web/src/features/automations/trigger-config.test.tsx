import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  describeTrigger,
  getDefaultTriggerConfig,
  parseCronExpression,
  toCronExpression,
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

describe('parseCronExpression', () => {
  it('reads back every schedule the form makes', () => {
    const base = { ...getDefaultTriggerConfig(), timezone: 'UTC' }
    const configs: TriggerConfig[] = [
      { ...base, frequency: 'hourly', time: '00:15' },
      { ...base, frequency: 'daily', time: '09:30' },
      { ...base, frequency: 'weekdays', time: '18:05' },
      { ...base, frequency: 'weekly', time: '07:00', dayOfWeek: 3 },
    ]
    for (const config of configs) {
      const parsed = parseCronExpression(toCronExpression(config), 'UTC')
      expect(describeTrigger(parsed)).toBe(describeTrigger(config))
    }
  })

  it('treats anything else as custom', () => {
    expect(parseCronExpression('*/5 * * * *', 'UTC').frequency).toBe('custom')
    expect(parseCronExpression('0 9 1 * *', 'UTC').frequency).toBe('custom')
    expect(parseCronExpression('not cron', 'UTC').frequency).toBe('custom')
  })
})
