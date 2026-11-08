import { Result, type Result as ResultValue } from 'better-result'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AutomationDoError, AutomationTriggerDO } from './automation-trigger-do'

vi.mock('agents', () => ({
  Agent: class {
    ctx: unknown
    env: unknown
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx
      this.env = env
    }
  },
}))
vi.mock('@garden/db/runtime', () => ({ getPooledDb: vi.fn() }))
vi.mock('@garden/server/automations/run-service', () => ({
  cancelAutomationRun: vi.fn(),
  startAutomationRun: vi.fn(),
}))

type DoResult = ResultValue<unknown, AutomationDoError>

/** The private steps the schedule path is built from, stubbed per test. */
type TriggerInternals = {
  fireScheduledRun: () => Promise<DoResult>
  scheduleNext: () => Promise<DoResult>
  schedule: (
    when: number | Date,
    callback: string,
    payload: unknown,
  ) => Promise<{ id: string }>
  cancelSchedule: (id: string) => Promise<boolean>
}

const CONFIG = {
  triggerId: 'trigger-1',
  automationId: 'automation-1',
  concurrencyPolicy: 'skip',
  scheduleId: 'schedule-1',
} as const

function failure(code: AutomationDoError['code']) {
  return Result.err(new AutomationDoError({ code, message: `${code} failed` }))
}

function setup() {
  const kv = new Map<string, unknown>([['config', CONFIG]])
  const ctx = {
    storage: {
      kv: {
        get: (key: string) => kv.get(key),
        put: (key: string, value: unknown) => kv.set(key, value),
        delete: (key: string) => kv.delete(key),
      },
    },
  }
  const trigger = new AutomationTriggerDO(
    ctx as unknown as ConstructorParameters<typeof AutomationTriggerDO>[0],
    {} as ConstructorParameters<typeof AutomationTriggerDO>[1],
  )
  const internals = trigger as unknown as TriggerInternals
  let scheduleCount = 0
  const schedule = vi.fn<TriggerInternals['schedule']>(async () => ({
    id: `retry-${++scheduleCount}`,
  }))
  internals.schedule = schedule
  internals.cancelSchedule = vi.fn(async () => true)
  const fireScheduledRun = vi
    .fn<TriggerInternals['fireScheduledRun']>()
    .mockResolvedValue(Result.ok())
  internals.fireScheduledRun = fireScheduledRun
  const scheduleNext = vi
    .fn<TriggerInternals['scheduleNext']>()
    .mockResolvedValue(Result.ok(new Date()))
  internals.scheduleNext = scheduleNext
  return { trigger, kv, schedule, fireScheduledRun, scheduleNext }
}

describe('AutomationTriggerDO scheduled fires', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('books the next run after a fire that fails', async () => {
    const { trigger, fireScheduledRun, scheduleNext, schedule } = setup()
    fireScheduledRun.mockResolvedValueOnce(failure('dispatch_failed'))

    await trigger.fireScheduledTrigger(CONFIG, { id: 'schedule-1' })

    expect(scheduleNext).toHaveBeenCalledTimes(1)
    expect(schedule).not.toHaveBeenCalled()
  })

  it('stores a retry wakeup when the next run cannot be booked', async () => {
    const { trigger, kv, schedule, scheduleNext } = setup()
    scheduleNext.mockResolvedValueOnce(failure('db_error'))

    await trigger.fireScheduledTrigger(CONFIG, { id: 'schedule-1' })

    expect(schedule).toHaveBeenCalledWith(60, 'retryScheduleNext', {
      triggerId: 'trigger-1',
      attempt: 2,
    })
    expect(kv.get('config')).toEqual({ ...CONFIG, scheduleId: 'retry-1' })
  })

  it('backs off between retries and stops once the next run is booked', async () => {
    const { trigger, schedule, scheduleNext } = setup()
    scheduleNext
      .mockResolvedValueOnce(failure('db_error'))
      .mockResolvedValueOnce(Result.ok(new Date()))

    await trigger.retryScheduleNext({ triggerId: 'trigger-1', attempt: 2 })
    expect(schedule).toHaveBeenLastCalledWith(120, 'retryScheduleNext', {
      triggerId: 'trigger-1',
      attempt: 3,
    })

    await trigger.retryScheduleNext({ triggerId: 'trigger-1', attempt: 3 })
    expect(schedule).toHaveBeenCalledTimes(1)
  })

  it('caps the retry delay at an hour', async () => {
    const { trigger, schedule, scheduleNext } = setup()
    scheduleNext.mockResolvedValueOnce(failure('schedule_error'))

    await trigger.retryScheduleNext({ triggerId: 'trigger-1', attempt: 12 })

    expect(schedule).toHaveBeenCalledWith(3600, 'retryScheduleNext', {
      triggerId: 'trigger-1',
      attempt: 13,
    })
  })

  it('does not retry configuration errors', async () => {
    const { trigger, schedule, scheduleNext } = setup()
    scheduleNext.mockResolvedValueOnce(failure('cron_error'))

    await trigger.fireScheduledTrigger(CONFIG, { id: 'schedule-1' })

    expect(schedule).not.toHaveBeenCalled()
  })

  it('throws when even the retry cannot be stored, so the SDK retries', async () => {
    const { trigger, schedule, scheduleNext } = setup()
    scheduleNext.mockResolvedValueOnce(failure('db_error'))
    schedule.mockRejectedValueOnce(new Error('storage unavailable'))

    await expect(
      trigger.fireScheduledTrigger(CONFIG, { id: 'schedule-1' }),
    ).rejects.toBeInstanceOf(AutomationDoError)
  })

  it('does not dispatch twice when the SDK redelivers a schedule row', async () => {
    const { trigger, fireScheduledRun, scheduleNext } = setup()

    await trigger.fireScheduledTrigger(CONFIG, { id: 'schedule-1' })
    await trigger.fireScheduledTrigger(CONFIG, { id: 'schedule-1' })

    expect(fireScheduledRun).toHaveBeenCalledTimes(1)
    expect(scheduleNext).toHaveBeenCalledTimes(2)
  })

  it('delays a first fire due before the installing transaction commits', async () => {
    const { trigger, schedule } = setup()
    const before = Date.now()

    const result = await trigger.install({
      triggerId: 'trigger-1',
      automationId: 'automation-1',
      concurrencyPolicy: 'skip',
      nextRunAt: new Date(before + 1_000),
    })

    expect(result.status).toBe('ok')
    const firstRunAt = schedule.mock.calls[0]?.[0]
    expect(
      firstRunAt instanceof Date && firstRunAt.getTime(),
    ).toBeGreaterThanOrEqual(before + 10_000)
  })

  it('ignores fires for a trigger that was uninstalled or replaced', async () => {
    const { trigger, kv, fireScheduledRun, scheduleNext } = setup()
    kv.delete('config')

    await trigger.fireScheduledTrigger(CONFIG, { id: 'schedule-1' })
    await trigger.retryScheduleNext({ triggerId: 'trigger-1', attempt: 2 })

    expect(fireScheduledRun).not.toHaveBeenCalled()
    expect(scheduleNext).not.toHaveBeenCalled()
  })
})
