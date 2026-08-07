import { Effect, Option, Schema } from 'effect'
import type { ConnectorToolClassification } from '../sdk.ts'
import { ConnectorDecodeError, type ConnectorError } from './errors.ts'

export type JsonSchemaObject = unknown

export type NativeConnectorToolHandler<
  TInput = unknown,
  TOutput = unknown,
  R = never,
> = (input: TInput) => Effect.Effect<TOutput, ConnectorError, R>

export type NativeConnectorTool = ConnectorToolClassification & {
  readonly name: string
  readonly description: string
  readonly inputSchema?: JsonSchemaObject
  readonly outputSchema?: JsonSchemaObject
  readonly execute: (
    input: unknown,
  ) => Effect.Effect<unknown, ConnectorError, unknown>
}

export type NativeConnectorToolDefinition<
  TInput = unknown,
  TOutput = unknown,
  R = never,
> = Omit<NativeConnectorTool, 'execute'> & {
  readonly input: Schema.Decoder<TInput>
  readonly output?: Schema.Schema<TOutput>
  readonly handler: NativeConnectorToolHandler<TInput, TOutput, R>
  readonly execute: (
    input: unknown,
  ) => Effect.Effect<TOutput, ConnectorError, R>
}

function standardJsonSchema(schema: Schema.Top, side: 'input' | 'output') {
  return Schema.toStandardJSONSchemaV1(schema)['~standard'].jsonSchema?.[side]({
    target: 'draft-07',
  })
}

/**
 * Defines an executable native connector tool without type erasure shortcuts.
 * Unknown AI/runtime args are decoded through Effect Schema before the typed
 * handler runs, so runtime code can call `execute(unknown)` without `any`.
 */
export function defineNativeConnectorTool<TInput, TOutput, R>(input: {
  readonly name: string
  readonly description: string
  readonly riskClass: ConnectorToolClassification['riskClass']
  readonly requiredScopes: readonly string[]
  readonly input: Schema.Decoder<TInput>
  readonly output?: Schema.Schema<TOutput>
  readonly handler: NativeConnectorToolHandler<TInput, TOutput, R>
}): NativeConnectorToolDefinition<TInput, TOutput, R> {
  return {
    name: input.name,
    description: input.description,
    riskClass: input.riskClass,
    requiredScopes: [...input.requiredScopes],
    input: input.input,
    ...(input.output ? { output: input.output } : {}),
    inputSchema: standardJsonSchema(input.input, 'input'),
    ...(input.output
      ? {
          outputSchema: standardJsonSchema(input.output, 'output'),
        }
      : {}),
    handler: input.handler,
    execute: (rawInput) => {
      const decoded = Schema.decodeUnknownOption(input.input)(rawInput)
      return Option.match(decoded, {
        onNone: () =>
          Effect.fail(
            new ConnectorDecodeError({
              connectorId: 'native',
              operation: input.name,
              message: `Invalid input for native connector tool ${input.name}`,
              cause: rawInput,
            }),
          ),
        onSome: (value) => input.handler(value),
      })
    },
  }
}

/**
 * Builds the registry classification map from native tool definitions. The old
 * registry stores risk/scope metadata separately from discovered MCP schemas;
 * native connectors declare that metadata beside static schemas and this helper
 * keeps both representations from drifting.
 */
export function nativeToolClassifications(
  tools: readonly Pick<
    NativeConnectorTool,
    'name' | 'riskClass' | 'requiredScopes' | 'description'
  >[],
): Record<string, ConnectorToolClassification> {
  return Object.fromEntries(
    tools.map((tool) => [
      tool.name,
      {
        riskClass: tool.riskClass,
        requiredScopes: [...tool.requiredScopes],
        descriptionOverride: tool.description,
      } satisfies ConnectorToolClassification,
    ]),
  )
}
