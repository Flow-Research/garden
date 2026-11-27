import type { TurnConfig } from '@cloudflare/think'

type ThinkTelemetry = NonNullable<TurnConfig['experimental_telemetry']>

/**
 * Turn telemetry for Think 0.24 on AI SDK 7.
 *
 * Think `_turnTelemetryV7` still reads legacy `metadata`, copies those values
 * into `runtimeContext`, and opts each key into `includeRuntimeContext` before
 * calling `streamText`. AI SDK 7's `TelemetryOptions` type dropped `metadata`,
 * so this helper bridges the typed surface while keeping run identity on traces.
 */
export function thinkTurnTelemetry(input: {
  functionId: string
  metadata?: Record<string, string | boolean>
}): ThinkTelemetry {
  const telemetry = {
    functionId: input.functionId,
    isEnabled: true,
    recordInputs: false,
    recordOutputs: false,
    ...(input.metadata
      ? {
          includeRuntimeContext: Object.fromEntries(
            Object.keys(input.metadata).map((key) => [key, true]),
          ),
          metadata: input.metadata,
        }
      : {}),
  }
  return telemetry as ThinkTelemetry
}
