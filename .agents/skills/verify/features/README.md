# Garden verification map

Each feature file names a user path and the observable result that proves it.
The map starts with the beta path and the Decide integration. Add a feature
file when a shipped user path needs repeatable proof.

| Feature | User path | Status |
| --- | --- | --- |
| [Email notifications](./email-notifications.md) | Mention a member or create an inbox item, then verify Resend delivery and deduplication | Database proof automated; live mailbox check pending |
| [MVP beta path](./mvp.md) | Connect a tool, chat, create an issue, run an agent, approve an action, review output | Documented; driver pending |
| [Decide integration](./decide.md) | Install Decide, diagnose the connection, and run a Decide-backed agent action | Documented; live environment check pending |
| [Internal handbook](./handbook.md) | Sign in, open `/handbook`, browse the Diátaxis sections, follow links, scroll a long page | Documented; checked by hand on PR #262 |
| [GitHub issue sync](./github-issue-sync.md) | Link a repository to a Team, see its open issues imported, see a new GitHub issue arrive assigned | Documented; route and UI tests pass; live check pending |
