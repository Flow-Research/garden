import {
  probeAgentModel,
  type AgentModelHealthFailure,
  type AgentModelHealthReport,
} from '@garden/agent-runtime/src/model-health'
import { createGardenLogger, errorFields } from '@garden/observability/logger'
import type { AppEnv } from '@/lib/server/env'
import { sendModelHealthAlertEmail } from '@/lib/server/email/model-health-alert'

// Daily at 08:00 UTC. The issue-run reconciler fires at 00:00 and 12:00 UTC,
// so each scheduled event names exactly one job.
export const MODEL_HEALTH_CHECK_CRON = '0 8 * * *'

/**
 * Cloudflare stops a Cron Trigger invocation after 15 minutes of wall time,
 * and nothing bounds `generateText` by default. Two minutes leaves the
 * invocation time to log and email the result, and a one-word answer that
 * takes longer than that already means agent turns are unusable.
 * https://developers.cloudflare.com/workers/platform/limits/#duration
 */
export const MODEL_HEALTH_PROBE_TIMEOUT_MS = 2 * 60 * 1000

export type ModelHealthAlertOutcome =
  | 'not_needed'
  | 'not_configured'
  | 'sent'
  | 'failed'

export type ModelHealthCheckOutcome = {
  report: AgentModelHealthReport
  alert: ModelHealthAlertOutcome
}

type ModelHealthCheckEnv = Pick<
  AppEnv,
  | 'AI'
  | 'AI_GATEWAY_ID'
  | 'ENVIRONMENT'
  | 'GARDEN_ALERT_EMAIL'
  | 'GARDEN_MODEL_API_KEY'
  | 'GARDEN_MODEL_BASE_URL'
  | 'GARDEN_MODEL_CONTEXT_WINDOW_TOKENS'
  | 'GARDEN_MODEL_ID'
  | 'GARDEN_MODEL_PROVIDER'
  | 'GARDEN_OFFLINE'
  | 'RESEND_API_KEY'
>

const logger = createGardenLogger({
  service: 'garden-staging',
  component: 'model-health-check',
})

/**
 * Probes the model Garden agents use and emails `GARDEN_ALERT_EMAIL` when it
 * is unhealthy. Runs once per scheduled event, so a failing model produces at
 * most one alert per day without stored alert state. Alert delivery failures
 * are logged and never change the health status.
 */
export async function runModelHealthCheck(
  env: ModelHealthCheckEnv,
  timeoutMs = MODEL_HEALTH_PROBE_TIMEOUT_MS,
): Promise<ModelHealthCheckOutcome> {
  const checkedAt = new Date()
  logger.info('model_health_check.started')

  const report = await probeAgentModel({
    ai: env.AI,
    env,
    gatewayId: env.AI_GATEWAY_ID,
    timeoutMs,
  })
  const fields = {
    status: report.status,
    provider: report.provider,
    modelId: report.modelId,
    durationMs: report.durationMs,
    finishReason: report.finishReason,
  }

  if (report.status === 'healthy') {
    logger.info('model_health_check.completed', {
      ...fields,
      alertAttempted: false,
      alert: 'not_needed' satisfies ModelHealthAlertOutcome,
    })
    return { report, alert: 'not_needed' }
  }

  logger.error('model_health_check.failed', {
    ...fields,
    failure: report.status,
    detail: report.detail,
  })
  const alert = await alertTeam(env, checkedAt, {
    ...report,
    status: report.status,
  })
  return { report, alert }
}

async function alertTeam(
  env: ModelHealthCheckEnv,
  checkedAt: Date,
  report: AgentModelHealthReport & { status: AgentModelHealthFailure },
): Promise<ModelHealthAlertOutcome> {
  const apiKey = env.RESEND_API_KEY?.trim()
  const recipients = (env.GARDEN_ALERT_EMAIL ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  if (!apiKey || recipients.length === 0) {
    logger.warn('model_health_check.alert_not_configured', {
      hasResendApiKey: Boolean(apiKey),
      recipientCount: recipients.length,
    })
    return 'not_configured'
  }

  const sent = await sendModelHealthAlertEmail({
    apiKey,
    recipients,
    environment: env.ENVIRONMENT ?? 'unknown',
    checkedAt,
    report,
  })
  return sent.match({
    ok: ({ id }) => {
      logger.info('model_health_check.alert_sent', {
        provider: 'resend',
        emailId: id,
        recipientCount: recipients.length,
      })
      return 'sent' as const
    },
    err: (error) => {
      logger.error('model_health_check.alert_failed', {
        provider: 'resend',
        code: error.code,
        statusCode: error.statusCode,
        recipientCount: recipients.length,
        message: error.message,
        ...(error.cause === undefined ? {} : errorFields(error.cause)),
      })
      return 'failed' as const
    },
  })
}
