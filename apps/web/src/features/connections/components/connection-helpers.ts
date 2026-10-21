/** Shared constants, types and formatting helpers for the connectors page. */
import { useEffect, useState } from 'react'
import type { Option } from 'effect'
import type {
  ExecutorIntegrationItem,
  ExecutorIntegrationSource,
  ExecutorIntegrationStatus,
} from '@/lib/executor-contract'

export const SEARCH_DEBOUNCE_MS = 150

export const BROWSE_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: 'productivity', label: 'Productivity' },
  { value: 'developer_tools', label: 'Developer tools' },
  { value: 'messaging', label: 'Messaging' },
  { value: 'analytics', label: 'Analytics' },
  { value: 'media', label: 'Media' },
  { value: 'financial', label: 'Finance' },
]

export type ProviderCardEntry = {
  readonly providerId: string
  readonly name: string
  readonly description: string
  readonly icon: Option.Option<string>
}

export type ManagedProvider = {
  readonly providerId: string
  readonly preferredIntegrationSlug: string | null
}

export function useDebouncedValue(value: string, delayMs: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timeout)
  }, [value, delayMs])
  return debounced
}

export function statusDotColor(status: ExecutorIntegrationStatus) {
  if (status === 'connected') return 'bg-success'
  if (status === 'degraded') return 'bg-background-warning-default'
  return 'bg-icon-tertiary'
}

export function statusLabelFor(status: ExecutorIntegrationStatus) {
  if (status === 'connected') return 'Connected'
  if (status === 'degraded') return 'Needs attention'
  if (status === 'setup_required') return 'Setup required'
  return 'Available'
}

export function formatToolName(raw: string) {
  const cleaned = raw.replace(/[_-]+/g, ' ').trim()
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : raw
}

export function installedIntegrationSource(
  integration: ExecutorIntegrationItem,
): ExecutorIntegrationSource {
  if (
    integration.protocol === 'github-app' ||
    integration.protocol === 'discord-bot' ||
    integration.protocol === 'native'
  ) {
    return 'native'
  }
  if (
    integration.protocol === 'google-api' ||
    integration.protocol === 'openapi'
  ) {
    return 'openapi'
  }
  if (integration.protocol === 'graphql') return 'graphql'
  return 'mcp'
}

export function sourceLabel(source: ExecutorIntegrationSource): string {
  if (source === 'mcp') return 'MCP'
  if (source === 'openapi') return 'OpenAPI'
  if (source === 'graphql') return 'GraphQL'
  return 'Native'
}

export function sourceDescription(source: ExecutorIntegrationSource): string {
  if (source === 'mcp') {
    return 'Use the provider’s remote MCP server and its published tools.'
  }
  if (source === 'openapi') {
    return 'Generate tools from the provider’s server-owned API definition.'
  }
  if (source === 'graphql') {
    return 'Generate tools from the provider’s server-owned GraphQL schema.'
  }
  return 'Use Garden’s provider-owned application and installation flow.'
}
