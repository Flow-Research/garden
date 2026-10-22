import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import type { McpProbeResult } from '@executor-js/plugin-mcp/core'
import { listServerOwnedExecutorProviders } from './catalog'
import { mcpAuthenticationTemplates } from './install'

/** Supplies the OAuth challenge returned by Decide without making tests call
 * the live provider. The live endpoint is verified separately at the HTTP
 * boundary; this test locks Garden's probe-to-template decision. */
const decideOAuthProbe: McpProbeResult = {
  connected: false,
  requiresAuthentication: true,
  requiresOAuth: true,
  supportsDynamicRegistration: true,
  name: 'api.trydecide.ai',
  slug: 'decide',
  toolCount: null,
  serverName: null,
  instructions: null,
}

describe('Executor installation authentication', () => {
  it.effect('declares OAuth when the Decide MCP probe requires it', () => {
    const provider = listServerOwnedExecutorProviders().find(
      (candidate) => String(candidate.installSlug) === 'decide',
    )
    expect(provider).toBeDefined()
    if (provider === undefined) return Effect.void

    return Effect.gen(function* () {
      const templates = yield* mcpAuthenticationTemplates(
        {
          mcp: {
            probeEndpoint: (input) => {
              expect(input).toEqual({
                endpoint: 'https://api.trydecide.ai/mcp',
              })
              return Effect.succeed(decideOAuthProbe)
            },
          },
        },
        provider.candidates[0],
        'https://api.trydecide.ai/mcp',
      )

      expect(templates).toEqual([{ slug: 'oauth2', kind: 'oauth2' }])
    })
  })
})
