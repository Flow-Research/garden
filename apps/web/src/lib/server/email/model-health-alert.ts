import { Resend } from 'resend'
import { Result, TaggedError } from 'better-result'
import {
  settleBefore,
  type AgentModelHealthFailure,
  type AgentModelHealthReport,
} from '@garden/agent-runtime/src/model-health'

const ALERT_FROM_EMAIL = 'Garden <hello@garden.flowresearch.tech>'

export class ModelHealthAlertError extends TaggedError(
  'ModelHealthAlertError',
)<{
  code: 'send_failed' | 'provider_rejected'
  message: string
  statusCode: number | null
  cause?: unknown
}>() {}

export type ModelHealthAlertInput = {
  apiKey: string
  recipients: string[]
  environment: string
  checkedAt: Date
  report: AgentModelHealthReport & { status: AgentModelHealthFailure }
}

const NEXT_STEP: Record<AgentModelHealthFailure, string> = {
  unavailable:
    'The provider says this model is retired or missing. Choose a supported model and update DEFAULT_AGENT_MODEL_PROFILE in packages/agent-runtime/src/model.ts.',
  timeout:
    'The model did not answer in time. Check Workers AI and AI Gateway status and latency for this model, then watch the next run.',
  provider_error:
    'The provider rejected the request. Check the AI Gateway logs and the provider status page for this model.',
  invalid_response:
    'The model answered without usable text. Check for a provider-side change to the model or its response format.',
  configuration_error:
    'The model could not be called with this Worker configuration. Check the AI binding, AI_GATEWAY_ID, and GARDEN_MODEL_* variables on this target.',
}

/**
 * Emails the team that the scheduled model health check failed. Uses the same
 * Resend account and sender as Garden's other transactional mail. Delivery
 * failures come back as a Result so the caller can log them without losing
 * the health outcome.
 */
export async function sendModelHealthAlertEmail(input: ModelHealthAlertInput) {
  const { report } = input
  const resend = new Resend(input.apiKey)
  const sent = await Result.tryPromise({
    try: async () =>
      await settleBefore(
        AbortSignal.timeout(10_000),
        resend.emails.send({
          from: ALERT_FROM_EMAIL,
          to: input.recipients,
          subject: `[Garden ${input.environment}] Model health check failed: ${report.status}`,
          text: renderModelHealthAlertText(input),
          tags: [{ name: 'kind', value: 'model_health_alert' }],
        }),
      ),
    catch: () =>
      new ModelHealthAlertError({
        code: 'send_failed',
        message: 'Resend request failed',
        statusCode: null,
      }),
  })

  return sent.andThen((response) =>
    response.error
      ? Result.err(
          new ModelHealthAlertError({
            code: 'provider_rejected',
            message: 'Resend rejected the alert.',
            statusCode: response.error.statusCode ?? null,
          }),
        )
      : Result.ok({ id: response.data?.id ?? null }),
  )
}

export function renderModelHealthAlertText({
  environment,
  checkedAt,
  report,
}: ModelHealthAlertInput) {
  return [
    `Garden's scheduled model health check failed on ${environment}.`,
    '',
    `Status: ${report.status}`,
    `Provider: ${report.provider}`,
    `Model: ${report.modelId}`,
    `Checked at: ${checkedAt.toISOString()}`,
    `Duration: ${report.durationMs} ms`,
    ...(report.finishReason ? [`Finish reason: ${report.finishReason}`] : []),
    ...(report.detail ? [`Detail: ${report.detail}`] : []),
    '',
    `Next step: ${
      report.status === 'unavailable' && report.provider === 'openai-compatible'
        ? 'Set GARDEN_MODEL_ID to a supported model on the configured compatible endpoint.'
        : NEXT_STEP[report.status]
    }`,
    '',
    'Agent runs on this target may fail until the model answers again. Search the Worker logs for event = "model_health_check.failed" to see each run.',
  ].join('\n')
}
