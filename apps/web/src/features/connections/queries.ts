/**
 * Query keys for the Executor connector registry (the public catalog of
 * connectors), as opposed to the workspace's own connections, which live in
 * `workspaceKeys.connections` (lib/workspace/queries.ts).
 */
export const executorRegistryKeys = {
  search: (query: string, category: string | null) =>
    ['executor-registry', query, category] as const,
  featured: () => ['executor-registry-featured'] as const,
  provider: (providerId: string | null) =>
    ['executor-registry-provider', providerId] as const,
  toolPreview: (providerId: string, source: string) =>
    ['executor-tool-preview', providerId, source] as const,
}
