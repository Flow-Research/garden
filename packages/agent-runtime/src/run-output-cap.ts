/** Existing user-facing failure cause for a run step that reaches its output limit. */
export const RUN_OUTPUT_CAP_REACHED = 'output_cap_reached'

/** Returns true when the model ended a step because it reached its output token limit. */
export function isOutputCapFinishReason(finishReason: string): boolean {
  return finishReason === 'length'
}
