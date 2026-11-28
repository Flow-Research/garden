import { Agent, routeAgentRequest } from 'agents'
import { Think } from '@cloudflare/think'
import type { LanguageModel, UIMessage } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'

declare const __CHUNKS__: number

type Env = { RootAgent: DurableObjectNamespace<RootAgent> }

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}

function streamingModel(chunks: number): LanguageModel {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] })
          controller.enqueue({ type: 'text-start', id: 't' })
          for (let index = 0; index < chunks; index += 1) {
            controller.enqueue({
              type: 'text-delta',
              id: 't',
              delta: `<${index}>`,
            })
          }
          controller.enqueue({ type: 'text-end', id: 't' })
          controller.enqueue({
            type: 'finish',
            usage,
            finishReason: { unified: 'stop', raw: 'stop' },
          })
          controller.close()
        },
      }),
    }),
  })
}

export class RunFacet extends Think<Env> {
  override getModel() {
    return streamingModel(__CHUNKS__)
  }

  async submit(id: string) {
    const message: UIMessage = {
      id,
      role: 'user',
      parts: [{ type: 'text', text: 'run' }],
    }
    const submission = await this.submitMessages([message], {
      submissionId: id,
      idempotencyKey: id,
    })
    return submission.status
  }

  async status(id: string) {
    return (await this.inspectSubmission(id))?.status ?? 'missing'
  }
}

export class RootAgent extends Agent<Env> {
  counts = { broadcast: 0 }

  // agents@0.34 dropped PartyServer `setName`; root wake traffic for
  // streamed facets now shows up as `_cf_broadcastToSubAgent` only.
  override async _cf_broadcastToSubAgent(
    ...args: Parameters<Agent<Env>['_cf_broadcastToSubAgent']>
  ) {
    this.counts.broadcast += 1
    return super._cf_broadcastToSubAgent(...args)
  }

  async start(id: string) {
    const facet = await this.subAgent(RunFacet, 'run-1')
    return facet.submit(id)
  }

  async status(id: string) {
    const facet = await this.subAgent(RunFacet, 'run-1')
    return facet.status(id)
  }

  resetCounts() {
    this.counts = { broadcast: 0 }
  }

  readCounts() {
    return this.counts
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routeAgentRequest(request, env)) ??
      new Response('not found', { status: 404 })
    )
  },
}
