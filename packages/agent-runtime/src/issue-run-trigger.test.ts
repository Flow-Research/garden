import { describe, expect, it } from 'vitest'

import { renderCommentTriggerReason } from './issue-run-trigger'

/** FLO-150 (issue #374): Abiola asked Garden to list checkers already in the approved guide. */
const FLO_150_COMMENT =
  '@Garden can you list the PRE and POST submission checkers?'

describe('renderCommentTriggerReason', () => {
  it('frames the mention comment as the whole task and gates outside actions', () => {
    const prompt = renderCommentTriggerReason({
      source: 'mention',
      authorName: 'Abiola',
      body: FLO_150_COMMENT,
    })

    expect(prompt).toContain(
      `Abiola mentioned you in a comment: "${FLO_150_COMMENT}"`,
    )
    expect(prompt).toContain('Your task this run is what this comment asks')
    expect(prompt).toContain('"Done when" line is the end goal, not permission')
    expect(prompt).toContain('opening PRs')
    expect(prompt).toContain('suggest it in your reply')
    expect(prompt).toContain('Do not call `mark_blocked`')
  })

  it('applies the same scope rule to member replies', () => {
    const prompt = renderCommentTriggerReason({
      source: 'comment',
      authorName: 'Abiola',
      body: 'Please add a FAQ section.',
    })

    expect(prompt).toContain('Abiola replied: "Please add a FAQ section."')
    expect(prompt).toContain('Your task this run is what this comment asks')
  })

  it('truncates long comment bodies', () => {
    const prompt = renderCommentTriggerReason({
      source: 'mention',
      authorName: 'Abiola',
      body: 'x'.repeat(600),
    })

    expect(prompt).toContain(`"${'x'.repeat(500)}..."`)
  })
})
