# Garden verification map

Each feature file names a user path and the observable result that proves it.
The map starts with the beta path and the Decide integration. Add a feature
file when a shipped user path needs repeatable proof.

| Feature | User path | Status |
| --- | --- | --- |
| [MVP beta path](./mvp.md) | Connect a tool, chat, create an issue, run an agent, approve an action, review output | Documented; driver pending |
| [Workspace memberships](./workspaces.md) | Create a workspace, accept an invitation, see both in the account menu without reload | Creation, router, and menu regression coverage |
| [Decide integration](./decide.md) | Install Decide, diagnose the connection, and run a Decide-backed agent action | Documented; live environment check pending |
| [Internal handbook](./handbook.md) | Sign in, open `/handbook`, browse the Diátaxis sections, follow links, scroll a long page | Documented; checked by hand on PR #262 |
| [GitHub issue sync](./github-issue-sync.md) | Link a repository to a Team, see its open issues imported, see a new GitHub issue arrive assigned | Documented; route and UI tests pass; live check pending |
| [Shared skills client](./shared-client.md) | Read skills, refuse access and switch sessions without stale data | Automated portable/HTTP/UI fixtures; local-app check recorded separately |
