export const env = {}

/** Minimal constructor surface for Node Vitest modules that define Worker DOs. */
export class DurableObject<Environment = unknown> {
  protected readonly ctx: DurableObjectState
  protected readonly env: Environment

  constructor(ctx: DurableObjectState, env: Environment) {
    this.ctx = ctx
    this.env = env
  }
}
