const MAX_TRIGGER_COMMENT_LENGTH = 500

/**
 * Renders the trigger line for an issue run started by a member comment or mention.
 *
 * Why: on FLO-150 (issue #374) a mention asked Garden to list checkers that already
 * lived in the approved work product. The prompt only quoted the comment, so Garden
 * fell back to the issue's "Done when" line, tried to open an unrequested PR, and
 * called `mark_blocked`. Before: the comment was context. After: the comment's
 * request is stated as the run's whole task, and outside actions are gated on a
 * person asking for or approving them. Kept pure so the prompt is testable without
 * booting the issue-run Durable Object.
 */
export function renderCommentTriggerReason(input: {
  source: 'comment' | 'mention'
  authorName: string
  body: string
}) {
  const body =
    input.body.length > MAX_TRIGGER_COMMENT_LENGTH
      ? `${input.body.slice(0, MAX_TRIGGER_COMMENT_LENGTH).trimEnd()}...`
      : input.body
  const opening =
    input.source === 'mention'
      ? `${input.authorName} mentioned you in a comment: "${body}"`
      : `${input.authorName} replied: "${body}"`

  return [
    opening,
    '',
    'Your task this run is what this comment asks, and nothing beyond it. Answer from the issue, its work products, and its comments when they already hold the answer.',
    `The issue's "Done when" line is the end goal, not permission. Take actions outside Garden (opening PRs, writing to GitHub, sending messages) only when this comment asks for them or a person approves them. If you think one is the next step, suggest it in your reply instead of attempting it. Do not call \`mark_blocked\` because an action nobody asked for is unavailable.`,
  ].join('\n')
}
