/**
 * Query keys for the public skills.sh catalog (search and previews of
 * importable skills). The workspace's own skills use `workspaceKeys.skills`
 * and `workspaceKeys.skill` (lib/workspace/queries.ts).
 */
export const skillsShKeys = {
  search: (query: string) => ['skills.sh-search', query] as const,
  preview: (url: string) => ['skills.sh-preview', url] as const,
}
