/**
 * Builds the canonical in-app path for opening an issue. Issue details are
 * routed pages in the redesigned shell (`/tasks/:issueId`) — the old
 * `/workspace?issue=<id>` dock-panel URL redirects there for back-compat with
 * links already issued. The workspace query parameter lets auth select the
 * correct organization before the surface loads.
 */
export function buildIssueDeepLinkPath(
  workspaceId: string,
  issueId: string,
): string {
  const search = new URLSearchParams({
    workspace_id: workspaceId,
  })
  return `/tasks/${encodeURIComponent(issueId)}?${search.toString()}`
}

/** Builds an absolute issue deep link for emails and other external surfaces. */
export function buildIssueDeepLink(
  baseURL: string,
  workspaceId: string,
  issueId: string,
): string {
  return new URL(buildIssueDeepLinkPath(workspaceId, issueId), baseURL).href
}
