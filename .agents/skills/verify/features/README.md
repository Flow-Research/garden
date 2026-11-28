# Garden verification map

Each feature file names a user path and the observable result that proves it.
The map starts with the beta path and the Decide integration. Add a feature
file when a shipped user path needs repeatable proof.

| Feature | User path | Status |
| --- | --- | --- |
| [Authentication dependency security](./auth-security.md) | Password sessions, connector callbacks, owned unlink and server-function origin checks | Real local handler/database regressions; provider and retained-target proof pending |
| [MVP beta path](./mvp.md) | Connect a tool, chat, create an issue, run an agent, approve an action, review output | Documented; driver pending |
| [Workspace memberships](./workspaces.md) | Create a workspace, accept an invitation, see both in the account menu without reload | Creation, router, and menu regression coverage |
| [Workstream integration](./workstream.md) | Connect an invited personal account, refuse Workspace credentials, refresh, and isolate members | Focused registration/route coverage; live check pending |
| [Decide integration](./decide.md) | Install Decide, diagnose the connection, and run a Decide-backed agent action | Documented; live environment check pending |
| [Internal handbook](./handbook.md) | Sign in, open `/handbook`, browse the Diátaxis sections, follow links, scroll a long page | Documented; checked by hand on PR #262 |
| [GitHub issue sync](./github-issue-sync.md) | Link a repository to a Team, see its open issues imported, see a new GitHub issue arrive assigned | Documented; route and UI tests pass; live check pending |
| [Shared skills client](./shared-client.md) | Read skills, refuse access and switch sessions without stale data | Automated portable/HTTP/UI fixtures; local-app check recorded separately |
| [Home dashboard](./dashboard.md) | Overview, distributions, detail panels, responsive layout, and navigation | Component regression coverage; local-app evidence recorded separately |
| [Settings page](./settings.md) | Direct section links, browser history, responsive shell, and existing modal entry | Shell route regression coverage; local-app evidence recorded separately |
| [Responsive Skills library](./skills.md) | Browse, filter, read and edit complete skill bundles on mobile and desktop | Component/client regression tests; local offline browser proof |
| [Task detail](./tasks.md) | Edit task properties, browse activity and comments, manage sub-tasks, and review agent work | Component regressions; local browser proof recorded separately |
