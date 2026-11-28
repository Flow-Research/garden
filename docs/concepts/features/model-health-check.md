---
title: Model health check
description: How the daily scheduled check probes Garden's configured agent model, classifies failures, and alerts the team.
status: current
owner: '@Umoren'
last_reviewed: 2026-11-26
---

Related issue: [#442](https://github.com/Flow-Research/garden/issues/442)

## What the feature does

Once a day, every deployed Garden Worker sends one short prompt to the model that agent turns use. If the model does not give a usable answer, the Worker logs a structured failure and emails the team at `GARDEN_ALERT_EMAIL`. The team learns that a model was retired or broken before a user's run fails on it.

## Why it works this way

- **It probes the runtime model, not a copy.** The probe resolves the model with `resolveAgentModelProfile` and builds it with `createAgentModel`, the same calls agent turns make. Changing `DEFAULT_AGENT_MODEL_PROFILE` or the `GARDEN_MODEL_*` variables changes what the check probes. A hard-coded model id could pass while agents fail.
- **It is one inference call, not an agent run.** The probe calls `generateText` with the prompt `Reply with the single word OK.` It starts no Think turn, tools, Workflow, sandbox, or database write, so a daily run costs a few tokens.
- **Any non-empty answer is healthy.** Models phrase "OK" differently, and an exact-match check would raise false alerts. The check fails an empty answer and a finish reason other than `stop` or `length`.
- **No retries.** The AI SDK retries a failed call twice by default. The probe sets `maxRetries: 0` so the first failure is reported, not hidden.
- **The probe is bounded at two minutes.** Nothing bounds `generateText` by default, and Cloudflare stops a Cron Trigger invocation after 15 minutes of wall time ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/#duration)), which would end the run with no log or alert. Two minutes leaves time to log and email. A one-word answer that takes longer already means agent turns are unusable. The bound rejects even if the provider ignores the abort signal.
- **Alert deduplication comes from the schedule.** The check runs once a day and sends at most one email per run, so a broken model sends one email a day. Garden stores no alert state. If the check runs more often, this needs a stored "last alerted" state, which is a separate design decision.
- **Email through Resend.** Garden has no team alert channel. The check reuses the Resend account and sender of Garden's transactional mail instead of adding a provider.

## Scope

In scope:

- The model selected for agent turns on each target: Workers AI by default, or an OpenAI-compatible endpoint chosen through `GARDEN_MODEL_PROVIDER` or `GARDEN_OFFLINE`.
- Failure classification, structured logs, and one email alert per failed run.

Out of scope:

- Checking models other than the configured agent model, such as embedding models.
- Checking that Cloudflare's model catalog still lists the model before it is retired.
- Alerting by Slack, Discord, or another channel.
- Showing model health in the app.

## What the user sees

Users see nothing. The team sees:

1. Each day at 08:00 UTC, the Worker runs the check.
2. If the model is healthy, the Worker logs `model_health_check.completed` at `info`. Deployed Workers drop `info` logs by default, so a healthy day leaves only the Cron invocation in Workers Logs.
3. If the model is unhealthy, the Worker logs `model_health_check.failed` at `error` before it tries to email each address in `GARDEN_ALERT_EMAIL`. The subject reads `[Garden <environment>] Model health check failed: <status>`. The email gives the provider, model id, status, time, duration, a sanitized detail, and a next step.

| Status                | Meaning                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `healthy`             | The model answered with text.                                                                                                                              |
| `timeout`             | No answer within two minutes.                                                                                                                              |
| `unavailable`         | The provider retired the model (Workers AI error 5028 or "Model has been deprecated", detected by `observeRetiredAgentModel`) or answered HTTP 404 or 410. |
| `provider_error`      | Any other provider or network failure.                                                                                                                     |
| `invalid_response`    | The model answered with no text, or finished with a reason other than `stop` or `length`.                                                                  |
| `configuration_error` | The `AI` binding is missing, the model could not be built from the configuration, or the provider rejected the credentials with HTTP 401 or 403.           |

### Log events

All events come from the `model-health-check` component of the `garden-staging` service. Filter on `event` in Workers Logs, as described in [Find a problem in the Worker logs](../../guides/operate/debug-with-logs.md).

| Event                                     | Level   | Fields                                                                                   |
| ----------------------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| `model_health_check.started`              | `info`  | —                                                                                        |
| `model_health_check.completed`            | `info`  | `status`, `provider`, `modelId`, `durationMs`, `finishReason`, `alertAttempted`, `alert` |
| `model_health_check.failed`               | `error` | `status`, `provider`, `modelId`, `durationMs`, `finishReason`, `failure`, `detail`       |
| `model_health_check.alert_sent`           | `info`  | `emailId`, `recipientCount`                                                              |
| `model_health_check.alert_failed`         | `error` | `code` (`send_failed` or `provider_rejected`), `statusCode`, `message`, `recipientCount` |
| `model_health_check.alert_not_configured` | `warn`  | `hasResendApiKey`, `recipientCount`                                                      |
| `scheduled.job_failed`                    | `error` | `cron` and the thrown error                                                              |
| `scheduled.unknown_cron`                  | `error` | `cron`                                                                                   |

The separate alert event reports delivery status. The Worker waits up to ten seconds for the email request. A failed alert never changes `status`. Logs carry no API keys, request bodies, or full provider responses. For provider failures, `detail` contains a fixed message and, when available, the HTTP status code.

### Investigate an unhealthy status

1. Find `model_health_check.failed` for the target and read `status`, `modelId`, and `detail`.
2. For `unavailable` on an OpenAI-compatible endpoint, update `GARDEN_MODEL_ID`. For Workers AI, choose a supported model and update `DEFAULT_AGENT_MODEL_PROFILE` in `packages/agent-runtime/src/model.ts`. See [Fix setup problems](../../guides/develop/fix-setup-problems.md).
3. For `timeout` or `provider_error`, check the AI Gateway logs for the target's `AI_GATEWAY_ID` and the provider's status page. A one-off failure that passes the next day is usually a provider incident.
4. For `configuration_error`, check the `AI` binding and the `GARDEN_MODEL_*` variables on the target.
5. For `invalid_response`, check whether the provider changed the model's response format.

## Where it lives

- `packages/agent-runtime/src/model-health.ts`: `probeAgentModel` runs the probe and classifies the result.
- `apps/web/src/lib/server/model-health-check.ts`: `runModelHealthCheck` logs the result and sends the alert. `MODEL_HEALTH_CHECK_CRON` and `MODEL_HEALTH_PROBE_TIMEOUT_MS` set the schedule and bound.
- `apps/web/src/lib/server/email/model-health-alert.ts`: `sendModelHealthAlertEmail` writes and sends the email through Resend.
- `apps/web/src/server.ts`: `scheduledJobs` maps each Cron pattern to one job. Cloudflare sends one `scheduled` event for each pattern, so the reconciler and the health check fail independently.
- `apps/web/wrangler.jsonc` and `alchemy.run.ts`: both list `0 8 * * *` in their crons. `apps/web/src/server.test.ts` fails if either list differs from the jobs.

## Data and permissions

The check reads Worker bindings and variables only. It writes no database rows or files. It needs `AI` (or the `GARDEN_MODEL_*` endpoint), and for alerts, `RESEND_API_KEY` and `GARDEN_ALERT_EMAIL`.

`GARDEN_ALERT_EMAIL` is a comma-separated list of addresses. `alchemy.run.ts` binds it only when the deploy environment sets it, so set it in the Workers Builds environment of each target that should alert. Without it, failures are still logged, with a separate `model_health_check.alert_not_configured` event.

## How to verify it

- `pnpm --filter @garden/agent-runtime exec vitest run src/model-health.test.ts` covers classification against the real Workers AI and OpenAI-compatible providers with a fake binding and fetch.
- `pnpm --filter @garden/web exec vitest run src/lib/server/model-health-check.test.ts src/server.test.ts` covers logging, alerting, alert failure, Cron dispatch, and the Cron configuration.
- After a deploy, wait for the 08:00 UTC run and search the target's Workers Logs for `model_health_check` events.

## Gaps and follow-up

- A healthy run logs at `info`, which deployed Workers drop by default. To confirm that runs happen, look for the 08:00 UTC Cron invocation in Workers Logs or set `GARDEN_LOG_LEVEL` to `info`.
- A daily check finds a retired model up to a day late. Running more often needs stored alert state.
- The check does not prove that tool calls or long contexts work, only that the model answers.
