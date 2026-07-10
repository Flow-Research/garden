import { describe, expect, it } from 'vitest'
import { withoutIssueDeepLink } from './issue-deep-link-listener'

describe('withoutIssueDeepLink', () => {
  it('removes only the consumed issue parameter', () => {
    expect(
      withoutIssueDeepLink(
        '/workspace',
        new URLSearchParams(
          'workspace_id=workspace-1&issue=issue-1&source=email',
        ),
      ),
    ).toBe('/workspace?workspace_id=workspace-1&source=email')
  })

  it('returns a clean path when issue is the only parameter', () => {
    expect(
      withoutIssueDeepLink('/workspace', new URLSearchParams('issue=issue-1')),
    ).toBe('/workspace')
  })
})
