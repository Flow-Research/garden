import { z } from 'zod'
import { chatEvalTasks } from '../examples/chat-tasks.ts'
import { evalConfigurationSchema } from '../index.ts'
import {
  createInvalidChatTrialReport,
  runChatTask,
} from '../runner/chat-task.ts'
import { createTrialIdentity } from '../runner/issue-run.ts'

const positiveMillisecondsSchema = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(evalConfigurationSchema.shape.deadlineMs)

const providerEnvironmentSchema = z.object({
  GARDEN_EVAL_BASE_URL: evalConfigurationSchema.shape.baseUrl,
  GARDEN_EVAL_WORKSPACE_ID: evalConfigurationSchema.shape.workspaceId,
  GARDEN_EVAL_AGENT_ID: evalConfigurationSchema.shape.agentId,
  GARDEN_EVAL_SESSION_COOKIE: z
    .string()
    .min(1)
    .refine((value) => !/[\r\n]/.test(value)),
  GARDEN_EVAL_DEADLINE_MS: positiveMillisecondsSchema,
  GARDEN_EVAL_POLL_INTERVAL_MS: positiveMillisecondsSchema,
})

const providerContextSchema = z.object({
  vars: z.record(z.string(), z.unknown()),
})

/**
 * Adapts versioned Garden chat tasks to Promptfoo's provider API. Promptfoo
 * owns case execution and reports. Garden owns task fixtures, public runtime
 * calls, evidence, and the three trial outcomes. References: Promptfoo's
 * JavaScript provider contract and `packages/evals/src/runner/chat-task.ts`.
 */
export default class GardenProvider {
  id() {
    return 'garden-chat'
  }

  /**
   * Runs a registered Garden task and returns its safe report as metadata.
   * Before this adapter, Promptfoo could not exercise Garden's chat runtime.
   * References: Promptfoo's JavaScript provider contract and Garden's chat API.
   */
  async callApi(
    _prompt: string,
    context: unknown,
  ): Promise<Record<string, unknown>> {
    const parsedContext = providerContextSchema.safeParse(context)
    const taskId = parsedContext.success
      ? z.string().min(1).safeParse(parsedContext.data.vars.taskId)
      : null
    const task =
      taskId?.success === true ? chatEvalTasks.get(taskId.data) : undefined
    if (!task) {
      return { error: 'Promptfoo named an unknown Garden chat task.' }
    }

    const environment = providerEnvironmentSchema.safeParse(process.env)
    if (!environment.success) {
      return {
        error:
          'Set valid GARDEN_EVAL_BASE_URL, workspace, agent, session cookie, deadline, and poll interval values.',
      }
    }

    const configuration = evalConfigurationSchema.safeParse({
      baseUrl: environment.data.GARDEN_EVAL_BASE_URL,
      workspaceId: environment.data.GARDEN_EVAL_WORKSPACE_ID,
      agentId: environment.data.GARDEN_EVAL_AGENT_ID,
      deadlineMs: environment.data.GARDEN_EVAL_DEADLINE_MS,
      pollIntervalMs: environment.data.GARDEN_EVAL_POLL_INTERVAL_MS,
    })
    if (!configuration.success) {
      return { error: 'The Garden chat eval configuration is invalid.' }
    }

    const identity = createTrialIdentity({
      taskId: task.definition.taskId,
      taskVersion: task.definition.version,
    })
    const execution = await runChatTask({
      task,
      identity,
      config: {
        ...configuration.data,
        sessionCookie: environment.data.GARDEN_EVAL_SESSION_COOKIE,
      },
    })
    const providerResult = execution.match({
      ok: (value) => ({ report: value.report, response: value.response }),
      err: (error) => ({
        report: createInvalidChatTrialReport({
          task,
          identity,
          configuration: configuration.data,
          error,
        }),
        response: '',
      }),
    })

    return {
      output: providerResult.response,
      metadata: { garden: providerResult.report },
    }
  }
}
