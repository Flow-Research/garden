/**
 * Structural shapes of the Cloudflare bindings the run services consume.
 * `@garden/server` does not pull in `@cloudflare/workers-types` as an ambient
 * global; Workers (web app, agent runtime) pass the real bindings, which are
 * structurally assignable to these narrower types.
 */

/** The Hyperdrive binding; the services only read `connectionString`. */
export type HyperdriveConnection = { readonly connectionString: string }

export const RUN_WORKFLOW_CONTROL_EVENT_TYPE = 'run-control'

export type RunWorkflowControlEvent = { kind: 'resume' | 'cancel' }

export type RunWorkflowBinding = {
  get: (id: string) => Promise<{
    sendEvent: (event: {
      type: typeof RUN_WORKFLOW_CONTROL_EVENT_TYPE
      payload: RunWorkflowControlEvent
    }) => Promise<void>
  }>
}

/** Opaque Durable Object id; the real `DurableObjectId` satisfies it. */
export type AgentDOId = { toString(): string }

/**
 * The AgentDO namespace binding with the RPC stub methods a service calls.
 * Declared with method syntax so the real `DurableObjectNamespace`, whose
 * `get` takes a `DurableObjectId`, stays assignable without `any`.
 */
export type AgentDONamespace<Stub> = {
  idFromName(name: string): AgentDOId
  get(id: AgentDOId): Stub
}

const AGENT_RUNTIME_NAME_PATTERN = /^[A-Za-z0-9._:-]+$/

/** True when `value` is safe to use as an AgentDO runtime (instance) name. */
export function isAgentRuntimeName(value: string) {
  return AGENT_RUNTIME_NAME_PATTERN.test(value)
}
