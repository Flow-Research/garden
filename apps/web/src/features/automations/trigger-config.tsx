import { useMemo } from 'react'
import { Result } from 'better-result'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@garden/ui/components/ui/select'
import { cn } from '@garden/ui/lib/utils'

export type TriggerFrequency =
  | 'hourly'
  | 'daily'
  | 'weekdays'
  | 'weekly'
  | 'custom'

export interface TriggerConfig {
  frequency: TriggerFrequency
  time: string
  dayOfWeek: number
  cronExpression: string
  timezone: string
}

const FREQUENCIES: { value: TriggerFrequency; label: string }[] = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'custom', label: 'Custom' },
]

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Pacific/Auckland',
]

export function getLocalTimezone(): string {
  return Result.try(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
    .map((timezone) => timezone || 'UTC')
    .unwrapOr('UTC')
}

function getTimezoneOffset(timezone: string): string {
  if (timezone === 'UTC') return 'UTC'
  return Result.try(() =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date()),
  )
    .map(
      (parts) =>
        parts.find((part) => part.type === 'timeZoneName')?.value ?? timezone,
    )
    .unwrapOr(timezone)
}

function getTimezoneLabel(timezone: string): string {
  if (timezone === 'UTC') return 'UTC'
  const city = timezone.split('/').pop()?.replace(/_/g, ' ') ?? timezone
  return `${city} (${getTimezoneOffset(timezone)})`
}

function formatTime12h(time: string): string {
  const [h, m] = time.split(':')
  const hour = parseInt(h ?? '9', 10)
  const min = parseInt(m ?? '0', 10)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  return `${hour % 12 || 12}:${min.toString().padStart(2, '0')} ${ampm}`
}

export function getDefaultTriggerConfig(): TriggerConfig {
  return {
    frequency: 'daily',
    time: '09:00',
    dayOfWeek: 1,
    cronExpression: '0 9 * * 1-5',
    timezone: getLocalTimezone(),
  }
}

export function toCronExpression(config: TriggerConfig): string {
  const [h, m] = config.time.split(':')
  const hour = parseInt(h ?? '9', 10)
  const min = parseInt(m ?? '0', 10)
  switch (config.frequency) {
    case 'hourly':
      return `${min} * * * *`
    case 'daily':
      return `${min} ${hour} * * *`
    case 'weekdays':
      return `${min} ${hour} * * 1-5`
    case 'weekly':
      return `${min} ${hour} * * ${config.dayOfWeek}`
    case 'custom':
      return config.cronExpression
  }
}

export function describeTrigger(config: TriggerConfig): string {
  const offset = getTimezoneOffset(config.timezone)
  switch (config.frequency) {
    case 'hourly': {
      const min = parseInt(config.time.split(':')[1] ?? '0', 10)
      return `Runs every hour at :${min.toString().padStart(2, '0')}`
    }
    case 'daily':
      return `Runs daily at ${formatTime12h(config.time)} ${offset}`
    case 'weekdays':
      return `Runs weekdays at ${formatTime12h(config.time)} ${offset}`
    case 'weekly':
      return `Runs every ${DAYS_OF_WEEK[config.dayOfWeek]} at ${formatTime12h(config.time)} ${offset}`
    case 'custom':
      return `Custom schedule: ${config.cronExpression}`
  }
}

export function TriggerConfigSection({
  config,
  onChange,
}: {
  config: TriggerConfig
  onChange: (config: TriggerConfig) => void
}) {
  const timezones = useMemo(() => {
    const local = getLocalTimezone()
    const set = new Set(COMMON_TIMEZONES)
    return set.has(local) ? COMMON_TIMEZONES : [local, ...COMMON_TIMEZONES]
  }, [])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {FREQUENCIES.map((frequency) => (
          <button
            key={frequency.value}
            type="button"
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              config.frequency === frequency.value
                ? 'bg-foreground text-background'
                : 'bg-muted text-muted-foreground hover:text-foreground',
            )}
            onClick={() => onChange({ ...config, frequency: frequency.value })}
          >
            {frequency.label}
          </button>
        ))}
      </div>

      {config.frequency === 'custom' ? (
        <div>
          <label className="text-xs text-muted-foreground">
            Cron Expression
          </label>
          <input
            type="text"
            value={config.cronExpression}
            onChange={(event) =>
              onChange({ ...config, cronExpression: event.target.value })
            }
            placeholder="0 9 * * 1-5"
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-1 focus:ring-ring"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Standard 5-field cron (min hour dom month dow)
          </p>
        </div>
      ) : (
        <>
          <div className="flex gap-3">
            {config.frequency === 'hourly' ? (
              <div className="w-24">
                <label className="text-xs text-muted-foreground">Minute</label>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={parseInt(config.time.split(':')[1] ?? '0', 10)}
                  onChange={(event) => {
                    const minute = Math.max(
                      0,
                      Math.min(59, parseInt(event.target.value) || 0),
                    )
                    onChange({
                      ...config,
                      time: `00:${minute.toString().padStart(2, '0')}`,
                    })
                  }}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            ) : (
              <>
                <div className="w-28">
                  <label className="text-xs text-muted-foreground">Time</label>
                  <input
                    type="time"
                    value={config.time}
                    onChange={(event) =>
                      onChange({
                        ...config,
                        time: event.target.value || config.time,
                      })
                    }
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <label className="text-xs text-muted-foreground">
                    Timezone
                  </label>
                  <Select
                    value={config.timezone}
                    onValueChange={(value) =>
                      value && onChange({ ...config, timezone: value })
                    }
                  >
                    <SelectTrigger className="mt-1 w-full">
                      <SelectValue>
                        {() => getTimezoneLabel(config.timezone)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {timezones.map((timezone) => (
                        <SelectItem key={timezone} value={timezone}>
                          {getTimezoneLabel(timezone)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>

          {config.frequency === 'weekly' ? (
            <div>
              <label className="text-xs text-muted-foreground">Day</label>
              <div className="mt-1 flex gap-1">
                {DAYS_OF_WEEK.map((day, index) => (
                  <button
                    key={day}
                    type="button"
                    className={cn(
                      'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                      config.dayOfWeek === index
                        ? 'bg-foreground text-background'
                        : 'bg-muted text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => onChange({ ...config, dayOfWeek: index })}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}

      <p className="text-xs text-muted-foreground">{describeTrigger(config)}</p>
    </div>
  )
}
