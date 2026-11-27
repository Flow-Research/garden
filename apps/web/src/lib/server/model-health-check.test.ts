// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setGardenLogLevel } from '@garden/observability/logger'
import { getDefaultAgentModelProfile } from '@garden/agent-runtime/src/model'

const resend = vi.hoisted(() => ({
  apiKeys: [] as string[],
  send: vi.fn(),
}))

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: resend.send }
    constructor(apiKey: string) {
      resend.apiKeys.push(apiKey)
    }
  },
}))

const { runModelHealthCheck } = await import('./model-health-check')

type LogRecord = Record<string, unknown> & { event: string; level: string }

let logs: LogRecord[]

function captureLogs() {
  logs = []
  for (const level of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((record: unknown) => {
      if (record && typeof record === 'object' && 'event' in record) {
        logs.push(record as LogRecord)
      }
    })
  }
}

const logEvent = (event: string) => logs.find((log) => log.event === event)

// The Workers AI binding is the external boundary; everything between the
// scheduled job and the binding call is the real probe and model factory.
function aiBinding(run: () => Promise<unknown>) {
  return { run: vi.fn(run) } as { run: ReturnType<typeof vi.fn> } & Ai
}

function env(overrides: {
  AI: Ai
  GARDEN_ALERT_EMAIL?: string
  RESEND_API_KEY?: string
}) {
  return {
    ENVIRONMENT: 'staging' as const,
    GARDEN_ALERT_EMAIL: 'team@example.test, oncall@example.test',
    RESEND_API_KEY: 're_test_secret',
    ...overrides,
  }
}

const MODEL_ID = getDefaultAgentModelProfile().id

beforeEach(() => {
  setGardenLogLevel('debug')
  captureLogs()
  resend.apiKeys.length = 0
  resend.send.mockReset()
  resend.send.mockResolvedValue({ data: { id: 'email_1' }, error: null })
})

afterEach(() => {
  setGardenLogLevel(null)
  vi.restoreAllMocks()
})

describe('runModelHealthCheck', () => {
  it('reports a healthy model without alerting', async () => {
    const AI = aiBinding(async () => ({ response: 'OK' }))

    const outcome = await runModelHealthCheck(env({ AI }))

    expect(AI.run).toHaveBeenCalledOnce()
    expect(AI.run.mock.calls[0]?.[0]).toBe(MODEL_ID)
    expect(outcome).toMatchObject({
      report: { status: 'healthy', modelId: MODEL_ID },
      alert: 'not_needed',
    })
    expect(resend.send).not.toHaveBeenCalled()
    expect(logEvent('model_health_check.started')).toBeDefined()
    expect(logEvent('model_health_check.completed')).toMatchObject({
      level: 'info',
      status: 'healthy',
      provider: 'workers-ai',
      modelId: MODEL_ID,
      alertAttempted: false,
      alert: 'not_needed',
    })
    expect(logEvent('model_health_check.completed')?.timestamp).toEqual(
      expect.any(String),
    )
    expect(logEvent('model_health_check.failed')).toBeUndefined()
  })

  it('alerts the team once when the provider fails', async () => {
    const AI = aiBinding(async () => {
      throw new Error('AiError: 3040: Capacity temporarily exceeded')
    })

    const outcome = await runModelHealthCheck(env({ AI }))

    expect(outcome).toMatchObject({
      report: { status: 'provider_error' },
      alert: 'sent',
    })
    expect(resend.send).toHaveBeenCalledOnce()
    const email = resend.send.mock.calls[0]?.[0]
    expect(email.to).toEqual(['team@example.test', 'oncall@example.test'])
    expect(email.subject).toBe(
      '[Garden staging] Model health check failed: provider_error',
    )
    expect(email.text).toContain(`Model: ${MODEL_ID}`)
    expect(email.text).toContain('Provider: workers-ai')
    expect(email.text).toContain('Model request failed.')
    expect(email.text).toContain('Next step:')
    expect(email.text).not.toContain('re_test_secret')
    expect(logEvent('model_health_check.failed')).toMatchObject({
      level: 'error',
      status: 'provider_error',
      failure: 'provider_error',
      modelId: MODEL_ID,
    })
    expect(logEvent('model_health_check.alert_sent')).toMatchObject({
      emailId: 'email_1',
      recipientCount: 2,
    })
  })

  it('classifies a retired model as unavailable and alerts', async () => {
    const AI = aiBinding(async () => {
      throw new Error(
        `Workers AI API error (410 Gone): {"errors":[{"message":"AiError: Model has been deprecated: ${MODEL_ID}","code":5028}],"success":false}`,
      )
    })

    const outcome = await runModelHealthCheck(env({ AI }))

    expect(outcome.report.status).toBe('unavailable')
    expect(resend.send.mock.calls[0]?.[0].text).toContain(
      'DEFAULT_AGENT_MODEL_PROFILE',
    )
  })

  it('classifies a hung provider as a timeout and alerts', async () => {
    const AI = aiBinding(() => new Promise(() => {}))

    const outcome = await runModelHealthCheck(env({ AI }), 20)

    expect(outcome).toMatchObject({
      report: { status: 'timeout' },
      alert: 'sent',
    })
  })

  it('does not treat an empty answer as healthy', async () => {
    const AI = aiBinding(async () => ({ response: '' }))

    const outcome = await runModelHealthCheck(env({ AI }))

    expect(outcome).toMatchObject({
      report: { status: 'invalid_response' },
      alert: 'sent',
    })
  })

  it('reports a missing AI binding as a configuration error', async () => {
    const outcome = await runModelHealthCheck(
      // AppEnv types `AI` as bound; a misdeployed Worker can still lack it.
      env({ AI: undefined as never }),
    )

    expect(outcome).toMatchObject({
      report: { status: 'configuration_error', provider: 'workers-ai' },
      alert: 'sent',
    })
    expect(logEvent('model_health_check.failed')?.detail).toEqual(
      expect.stringContaining('AI'),
    )
  })

  it('logs the failed probe before an unresponsive mail request times out', async () => {
    const timeout = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
    resend.send.mockImplementation(() => {
      expect(logEvent('model_health_check.failed')).toBeDefined()
      timeout.abort()
      return new Promise(() => {})
    })
    const outcome = await runModelHealthCheck(
      env({ AI: aiBinding(async () => ({ response: '' })) }),
    )
    expect(outcome.alert).toBe('failed')
  })

  it('keeps the failure when alert delivery is rejected', async () => {
    resend.send.mockResolvedValue({
      data: null,
      error: {
        name: 'validation_error',
        message: 'Invalid `to` field',
        statusCode: 422,
      },
    })
    const AI = aiBinding(async () => {
      throw new Error('AiError: 3040: Capacity temporarily exceeded')
    })

    const outcome = await runModelHealthCheck(env({ AI }))

    expect(outcome).toMatchObject({
      report: { status: 'provider_error' },
      alert: 'failed',
    })
    expect(logEvent('model_health_check.alert_failed')).toMatchObject({
      level: 'error',
      code: 'provider_rejected',
      statusCode: 422,
    })
    expect(logEvent('model_health_check.failed')).toMatchObject({
      status: 'provider_error',
    })
  })

  it('keeps the failure when the alert request throws', async () => {
    resend.send.mockRejectedValue(new Error('network down'))
    const AI = aiBinding(async () => ({ response: '' }))

    const outcome = await runModelHealthCheck(env({ AI }))

    expect(outcome).toMatchObject({
      report: { status: 'invalid_response' },
      alert: 'failed',
    })
    expect(logEvent('model_health_check.alert_failed')).toMatchObject({
      code: 'send_failed',
    })
  })

  it('logs the failure without emailing when alerts are not configured', async () => {
    const AI = aiBinding(async () => {
      throw new Error('AiError: 3040: Capacity temporarily exceeded')
    })

    const outcome = await runModelHealthCheck(
      env({ AI, GARDEN_ALERT_EMAIL: '' }),
    )

    expect(outcome.alert).toBe('not_configured')
    expect(resend.send).not.toHaveBeenCalled()
    expect(logEvent('model_health_check.alert_not_configured')).toBeDefined()
    expect(logEvent('model_health_check.failed')).toMatchObject({})
  })

  it('never logs credentials', async () => {
    const AI = aiBinding(async () => {
      throw new Error('AiError: 3040: Capacity temporarily exceeded')
    })

    await runModelHealthCheck(env({ AI }))

    expect(JSON.stringify(logs)).not.toContain('re_test_secret')
  })
})
