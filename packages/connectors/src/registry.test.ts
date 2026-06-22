import { describe, expect, it } from 'vitest'
import { isMcpConnector, isNativeConnector } from './sdk.ts'
import { connectorRegistry } from './registry.ts'

describe('connectorRegistry', () => {
  it('keeps every tool classified with a valid risk class', () => {
    for (const connector of connectorRegistry) {
      for (const [toolName, tool] of Object.entries(connector.tools)) {
        expect(toolName).not.toHaveLength(0)
        expect(['read', 'write', 'send_external', 'destructive']).toContain(
          tool.riskClass,
        )
        expect(Array.isArray(tool.requiredScopes)).toBe(true)
      }
    }
  })

  it('keeps connector ids unique', () => {
    const ids = connectorRegistry.map((connector) => connector.id)
    expect(new Set(ids)).toHaveLength(ids.length)
  })

  it('keeps oauth provider ids unique', () => {
    const providerIds = connectorRegistry.flatMap((connector) =>
      isMcpConnector(connector) && connector.oauth
        ? [connector.oauth.providerId]
        : [],
    )
    expect(new Set(providerIds)).toHaveLength(providerIds.length)
  })

  it('keeps oauth tool scopes inside the connector scope set', () => {
    for (const connector of connectorRegistry) {
      if (!isMcpConnector(connector) || !connector.oauth) {
        continue
      }

      for (const tool of Object.values(connector.tools)) {
        for (const requiredScope of tool.requiredScopes) {
          expect(connector.oauth.scopes).toContain(requiredScope)
        }
      }
    }
  })

  it('keeps unauthenticated MCP connectors scope-free at the tool level', () => {
    for (const connector of connectorRegistry) {
      if (
        isNativeConnector(connector) ||
        (isMcpConnector(connector) && connector.oauth)
      ) {
        continue
      }

      for (const tool of Object.values(connector.tools)) {
        expect(tool.requiredScopes).toEqual([])
      }
    }
  })

  it('never treats destructive tools as auto-safe', () => {
    for (const connector of connectorRegistry) {
      for (const tool of Object.values(connector.tools)) {
        if (tool.riskClass === 'destructive') {
          expect(tool.riskClass).not.toBe('read')
        }
      }
    }
  })
})
