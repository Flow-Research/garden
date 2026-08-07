import { Effect, Option } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  catalogCandidateSource,
  getFeaturedExecutorCatalog,
  listServerOwnedExecutorProviders,
  projectExecutorProviders,
  providerSourceInstallSlug,
  type CatalogCandidate,
} from './catalog'
import { IntegrationsShCatalogEntry } from './integrations-sh'

const discoveredSlack = IntegrationsShCatalogEntry.make({
  id: 'mcp/slack',
  kind: 'mcp',
  slug: 'slack',
  name: 'Slack from integrations.sh',
  description: 'Discovery metadata that the Executor preset replaces.',
  url: Option.some('https://example.invalid/mcp'),
  spec: Option.none(),
  icon: Option.none(),
  domain: 'slack.com',
  categories: ['communication'],
  popularity: Option.some(100),
})

const discoveredBrowserbaseMcp = IntegrationsShCatalogEntry.make({
  id: 'discovered/browserbase-com-mcp',
  kind: 'mcp',
  slug: 'browserbase-com',
  name: 'browserbase.com',
  description: 'Browserbase MCP discovery metadata.',
  url: Option.some('https://mcp.browserbase.com/mcp'),
  spec: Option.none(),
  icon: Option.none(),
  domain: 'browserbase.com',
  categories: ['developer_tools'],
  popularity: Option.some(100),
})

const discoveredPosthogMcp = IntegrationsShCatalogEntry.make({
  id: 'mcp/posthog',
  kind: 'mcp',
  slug: 'posthog',
  name: 'PostHog',
  description: 'PostHog MCP tools.',
  url: Option.some('https://mcp.posthog.com/mcp'),
  spec: Option.none(),
  icon: Option.none(),
  domain: 'posthog.com',
  categories: ['analytics'],
  popularity: Option.some(100),
})

const discoveredDiscordOpenApi = IntegrationsShCatalogEntry.make({
  id: 'discovered/discord-com-openapi',
  kind: 'openapi',
  slug: 'discord-com',
  name: 'discord.com',
  description: 'Discord OpenAPI tools.',
  url: Option.none(),
  spec: Option.some('https://discord.com/openapi.json'),
  icon: Option.none(),
  domain: 'discord.com',
  categories: ['communication'],
  popularity: Option.some(100),
})

const discoveredGmailMcp = IntegrationsShCatalogEntry.make({
  id: 'discovered/gmail-googleapis-com-mcp',
  kind: 'mcp',
  slug: 'gmail-googleapis-com',
  name: 'gmail.googleapis.com',
  description: 'Gmail MCP tools.',
  url: Option.some('https://gmail.googleapis.com/mcp'),
  spec: Option.none(),
  icon: Option.none(),
  domain: 'gmail.googleapis.com',
  categories: ['productivity'],
  popularity: Option.some(100),
})

const discoveredBrowserbaseOpenApi = IntegrationsShCatalogEntry.make({
  id: 'discovered/browserbase-com-openapi',
  kind: 'openapi',
  slug: 'browserbase-com-openapi',
  name: 'browserbase.com',
  description: 'Browserbase OpenAPI discovery metadata.',
  url: Option.none(),
  spec: Option.some('https://api.browserbase.com/openapi.json'),
  icon: Option.none(),
  domain: 'browserbase.com',
  categories: ['developer_tools'],
  popularity: Option.some(100),
})

describe('Executor server-owned preset catalog', () => {
  const providers = projectExecutorProviders([
    discoveredSlack,
    discoveredBrowserbaseMcp,
    discoveredBrowserbaseOpenApi,
    discoveredPosthogMcp,
    discoveredDiscordOpenApi,
    discoveredGmailMcp,
  ])

  afterEach(() => vi.unstubAllGlobals())

  it('projects Executor presets instead of the hand-written Google subset', () => {
    expect(
      providers.some((provider) => provider.name === 'Google Slides'),
    ).toBe(true)
    expect(providers.some((provider) => provider.name === 'Google Forms')).toBe(
      true,
    )
    expect(providers.some((provider) => provider.name === 'Outlook Mail')).toBe(
      true,
    )
  })

  it('groups duplicate protocol presets under one install slug', () => {
    const stripe = providers.find(
      (provider) => String(provider.installSlug) === 'stripe',
    )

    expect(stripe?.candidates).toEqual([
      expect.objectContaining({ kind: 'preset', protocol: 'mcp' }),
      expect.objectContaining({ kind: 'preset', protocol: 'openapi' }),
    ])
    expect(stripe?.featured).toBe(true)
  })

  it('keeps every discovered source when Executor owns one source', () => {
    const browserbase = providers.find(
      (provider) => String(provider.installSlug) === 'browserbase',
    )
    const sources = new Set(browserbase?.candidates.map(catalogCandidateSource))

    expect(sources).toEqual(new Set(['mcp', 'openapi']))
    expect(browserbase?.name).toBe('Browserbase')
    if (browserbase === undefined) return
    expect(String(providerSourceInstallSlug(browserbase, 'mcp'))).toBe(
      'browserbase',
    )
    expect(String(providerSourceInstallSlug(browserbase, 'openapi'))).toBe(
      'browserbase--openapi',
    )
  })

  it('merges regional, native, and product API domains into one provider', () => {
    const posthog = providers.find(
      (provider) => String(provider.installSlug) === 'posthog',
    )
    const discord = providers.find(
      (provider) => String(provider.providerId) === 'discord.com',
    )
    const gmail = providers.find(
      (provider) => String(provider.installSlug) === 'google_gmail',
    )

    expect(new Set(posthog?.candidates.map(catalogCandidateSource))).toEqual(
      new Set(['mcp', 'openapi']),
    )
    expect(
      providers.filter(
        (provider) => String(provider.providerId) === 'discord.com',
      ),
    ).toHaveLength(1)
    expect(new Set(discord?.candidates.map(catalogCandidateSource))).toEqual(
      new Set(['native', 'openapi']),
    )
    expect(new Set(gmail?.candidates.map(catalogCandidateSource))).toEqual(
      new Set(['mcp', 'openapi']),
    )
    expect(String(gmail?.domain)).toBe('gmail.googleapis.com')
  })

  it('replaces matching integrations.sh providers with Executor metadata', () => {
    const slack = providers.filter(
      (provider) => String(provider.installSlug) === 'slack',
    )

    expect(slack).toHaveLength(1)
    expect(slack[0]?.name).toBe('Slack')
    expect(String(slack[0]?.providerId)).toBe('executor:slack')
  })

  it('serves Featured from local provider policy without catalog I/O', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    const response = await Effect.runPromise(getFeaturedExecutorCatalog())

    expect(fetch).not.toHaveBeenCalled()
    expect(Option.getOrNull(response.catalogSize)).toBeNull()
    expect(response.entries.length).toBeGreaterThan(1)
    expect(listServerOwnedExecutorProviders().length).toBeGreaterThan(
      response.entries.length,
    )
  })

  it('keeps unsafe presets out while preserving native provider sources', () => {
    const presetIds = providers.flatMap((provider) =>
      provider.candidates.flatMap((candidate: CatalogCandidate) =>
        candidate.kind === 'preset' ? [candidate.presetId] : [],
      ),
    )

    expect(presetIds).not.toContain('github-rest')
    expect(presetIds).not.toContain('github-graphql')
    expect(presetIds).not.toContain('emulate-mcp')
    expect(presetIds).not.toContain('chrome-devtools')
    expect(
      new Set(
        providers
          .find((provider) => provider.providerId === 'github.com')
          ?.candidates.map(catalogCandidateSource),
      ),
    ).toEqual(new Set(['native', 'mcp']))
  })
})
