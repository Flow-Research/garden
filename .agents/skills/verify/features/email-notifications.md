# Email notifications

1. As member A, create an issue assigned to member B with an explicit editor
   mention of B in its description. Expect assignment and mention inbox rows
   without B opening Garden.
2. Mention B in a comment. Edit the comment without changing its mention and
   retry the write. Expect one mention inbox row per recipient and source.
3. Mention yourself and a non-workspace user id. Expect no mention notification.
4. Mention a workspace member outside a private Team. Expect no issue notification.
5. Mention B in chat. Expect a generic private-chat notice without the chat title
   or message text. B still cannot access A's conversation.
6. Create an approval or input request through its real writer. Expect pending
   delivery state on the new inbox row.
7. Run the notification dispatcher with a simulated Resend sender. Expect sent
   state, workspace-aware links, escaped HTML, and one provider idempotency key
   per inbox id. Run again and expect no additional sends.
8. Fail a provider request, edit the inbox content, and retry. Expect the original
   payload and key. Remove recipient membership before retry and expect skipped.
9. Advance beyond the provider's 24-hour idempotency window after an ambiguous
   send. Expect failed state and no second provider call.

10. As member B, open Settings > Preferences, or the Notifications tab of the
    Settings modal. Expect four switches that are on, each with a name and a
    description for screen readers.
11. Queue an assignment for B, then turn off Assignments. Run the dispatcher.
    Expect `skipped` with `preference_disabled` and no provider call. Repeat
    after a failed attempt. Expect the same result.
12. Turn off Mentions only. Expect assignments to still send. Expect the same
    user in a second workspace to still get assignment email. Expect
    `new_comment` email with all four switches off.
13. Send a `PATCH` for B with an extra member field or an unknown category.
    Expect `400`. Send one as a user outside the workspace. Expect `403`.

Database integration tests automate writer and dispatch checks against isolated
Postgres. Use `pnpm --filter @garden/web exec vitest run
src/lib/server/email/notifications.integration.test.ts` and
`'src/routes/api/workspaces/$id/-notification-preferences.integration.test.ts'`.

A live mailbox check requires the deployed minute cron, `RESEND_API_KEY`,
`BETTER_AUTH_URL`, and a verified sender. Record that proof separately from the
simulated provider tests. Never send test notifications to real workspace members.
