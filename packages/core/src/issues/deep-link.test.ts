import { describe, expect, it } from 'vitest'
import { buildIssueDeepLink, buildIssueDeepLinkPath } from './deep-link'

describe('issue deep links', () => {
  it('builds a task detail path carrying the workspace', () => {
    expect(buildIssueDeepLinkPath('workspace-1', 'issue-2')).toBe(
      '/tasks/issue-2?workspace_id=workspace-1',
    )
  })

  it('builds an absolute link for external surfaces', () => {
    expect(
      buildIssueDeepLink(
        'https://garden.example/settings',
        'workspace-1',
        'issue-2',
      ),
    ).toBe('https://garden.example/tasks/issue-2?workspace_id=workspace-1')
  })

  it('encodes identifiers before placing them in the URL', () => {
    expect(buildIssueDeepLinkPath('workspace & one', 'issue/two')).toBe(
      '/tasks/issue%2Ftwo?workspace_id=workspace+%26+one',
    )
  })
})
