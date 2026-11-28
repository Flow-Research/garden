import type {
  LanguageModelV4,
  LanguageModelV4Prompt,
  LanguageModelV4Usage,
} from '@ai-sdk/provider'
import {
  captureAiGeneration,
  type CaptureAiGenerationOptions,
} from '@posthog/ai'
import type { PostHog } from 'posthog-node'
import { wrapLanguageModel } from 'ai'
import { Result } from 'better-result'

const TRACE_LIMIT = 16 * 1024
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const omitted = '[truncated]'

/** Limit the telemetry copy without changing the model request or response. */
function preview(text: string) {
  const bytes = encoder.encode(text.slice(0, TRACE_LIMIT + 1))
  if (bytes.length <= TRACE_LIMIT) return text
  return (
    decoder.decode(bytes.subarray(0, TRACE_LIMIT - 256), { stream: false }) +
    omitted
  )
}

function promptPreview(prompt: LanguageModelV4Prompt) {
  const messages = []
  let remaining = TRACE_LIMIT
  for (const message of prompt) {
    const content =
      typeof message.content === 'string'
        ? preview(message.content)
        : message.content
            .slice(0, 32)
            .map((part) =>
              part.type === 'text'
                ? { type: part.type, text: preview(part.text) }
                : { type: part.type },
            )
    const entry = { role: message.role, content }
    const size = encoder.encode(JSON.stringify(entry)).length + 1
    if (size > remaining) {
      messages.push({ role: message.role, content: omitted })
      break
    }
    messages.push(entry)
    remaining -= size
  }
  return messages
}

type OutputPart =
  | { type: 'text'; text: string }
  | {
      type: 'tool-call'
      id: string
      function: { name: string; arguments: string }
    }

function callPart(part: {
  toolCallId: string
  toolName: string
  input: string
}): OutputPart {
  return {
    type: 'tool-call',
    id: preview(part.toolCallId),
    function: { name: preview(part.toolName), arguments: preview(part.input) },
  }
}

function assistantOutput(parts: OutputPart[]) {
  const content: OutputPart[] = []
  let remaining = TRACE_LIMIT
  for (const part of parts) {
    const size = encoder.encode(JSON.stringify(part)).length + 1
    if (size > remaining) {
      content.push({ type: 'text', text: omitted })
      break
    }
    content.push(part)
    remaining -= size
  }
  return [
    {
      role: 'assistant',
      content:
        content.length === 1 && content[0]?.type === 'text'
          ? content[0].text
          : content,
    },
  ]
}

/** The PostHog Vercel adapter only wraps V2 and V3 models. Use its public
 * generation capture API for V4 while preserving the provider's stream. */
export function traceV4Model(
  model: LanguageModelV4,
  client: PostHog,
  options: Omit<CaptureAiGenerationOptions, 'input' | 'output'>,
  waitUntil: (promise: Promise<unknown>) => void,
) {
  function start(input: LanguageModelV4Prompt) {
    const startTime = Date.now()
    let captured = false
    return (output: unknown, usage?: LanguageModelV4Usage, error?: unknown) => {
      if (captured) return
      captured = true
      const pending = captureAiGeneration(client, {
        ...options,
        input: options.privacyMode ? undefined : promptPreview(input),
        output: options.privacyMode ? undefined : output,
        latency: (Date.now() - startTime) / 1000,
        ...(usage
          ? {
              usage: {
                inputTokens: usage.inputTokens.total,
                outputTokens: usage.outputTokens.total,
                cacheReadInputTokens: usage.inputTokens.cacheRead,
                cacheCreationInputTokens: usage.inputTokens.cacheWrite,
                reasoningTokens: usage.outputTokens.reasoning,
              },
            }
          : {}),
        ...(error === undefined
          ? {}
          : { error: new Error('Agent model request failed.') }),
      })
      waitUntil(pending)
    }
  }
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: 'v4',
      async wrapGenerate({ params, doGenerate }) {
        const report = start(params.prompt)
        const result = await Promise.resolve()
          .then(doGenerate)
          .catch((error: unknown) => {
            report(undefined, undefined, error)
            throw error
          })
        const parts: OutputPart[] = []
        if (!options.privacyMode) {
          for (const part of result.content.slice(0, 32)) {
            if (part.type === 'text')
              parts.push({ type: 'text', text: preview(part.text) })
            if (part.type === 'tool-call') parts.push(callPart(part))
          }
        }
        report(assistantOutput(parts), result.usage)
        return result
      },
      async wrapStream({ params, doStream }) {
        const report = start(params.prompt)
        const result = await Promise.resolve()
          .then(doStream)
          .catch((error: unknown) => {
            report(undefined, undefined, error)
            throw error
          })
        const reader = result.stream.getReader()
        let text = ''
        const parts: OutputPart[] = []
        const output = () =>
          assistantOutput(
            text ? [...parts, { type: 'text', text: preview(text) }] : parts,
          )
        return {
          ...result,
          stream: new ReadableStream({
            async pull(controller) {
              const read = await Result.tryPromise({
                try: () => reader.read(),
                catch: (error) => error,
              })
              if (read.isErr()) {
                report(undefined, undefined, read.error)
                controller.error(read.error)
                return
              }
              const next = read.value
              if (next.done) {
                report(
                  output(),
                  undefined,
                  new Error('Stream ended before finish'),
                )
                controller.close()
                return
              }
              const part = next.value
              if (
                part.type === 'text-delta' &&
                !options.privacyMode &&
                text.length < 16384
              ) {
                text += part.delta.slice(0, 16384 - text.length)
              }
              if (
                !options.privacyMode &&
                part.type === 'tool-call' &&
                parts.length < 32
              ) {
                if (text) {
                  parts.push({ type: 'text', text: preview(text) })
                  text = ''
                }
                parts.push(callPart(part))
              }
              if (part.type === 'finish') report(output(), part.usage)
              if (part.type === 'error')
                report(undefined, undefined, part.error)
              controller.enqueue(part)
            },
            async cancel(reason) {
              report(undefined, undefined, new Error('Stream cancelled'))
              await reader.cancel(reason)
            },
          }),
        }
      },
    },
  })
}
