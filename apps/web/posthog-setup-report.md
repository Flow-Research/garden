<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into the Garden TanStack Start app. Client-side tracking is wired through `PostHogProvider` in the root route, with `identify` called on signin and signup. A server-side singleton (`src/lib/posthog-server.ts`) captures 8 events across the key API routes using `posthog-node` with immediate flushing — required for Cloudflare Workers where the isolate may terminate before a periodic flush fires. Environment variables (`VITE_PUBLIC_POSTHOG_PROJECT_TOKEN`, `VITE_PUBLIC_POSTHOG_HOST`) are set in root `.env` and referenced via `import.meta.env` throughout.

| Event                     | Description                                                 | File                                                           |
| ------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------- |
| `user_signed_in`          | User successfully authenticated via the sign-in form        | `src/features/auth/login-page.tsx`                             |
| `user_signed_up`          | User created a new account via the sign-up form             | `src/features/auth/login-page.tsx`                             |
| `workspace_created`       | A new workspace was created by a user                       | `src/routes/api/workspaces.ts`                                 |
| `issue_created`           | A new issue was created in a workspace                      | `src/routes/api/issues.ts`                                     |
| `agent_created`           | A new AI agent was created in a workspace                   | `src/routes/api/agents.ts`                                     |
| `automation_created`      | A new automation was created with optional schedule trigger | `src/routes/api/automations.ts`                                |
| `automation_triggered`    | An automation was manually or programmatically triggered    | `src/routes/api/automations/$id/trigger.ts`                    |
| `chat_thread_created`     | A new chat thread was opened with an AI agent               | `src/routes/api/chat/threads.ts`                               |
| `skill_imported`          | A skill was imported from skills.sh into a workspace        | `src/routes/api/skills/import.ts`                              |
| `tool_permission_granted` | A user granted a connector tool permission to an AI agent   | `src/routes/api/connections/$connectorId/tools/$name/grant.ts` |

## Next steps

We've built insights and a dashboard to monitor user behavior based on the events just instrumented:

- **Dashboard**: [Analytics basics (wizard)](https://us.posthog.com/project/478904/dashboard/1739190)
- **Insight**: [New signups & sign-ins](https://us.posthog.com/project/478904/insights/DC1zvaVg)
- **Insight**: [Core product engagement](https://us.posthog.com/project/478904/insights/dH1TbNhs)
- **Insight**: [Activation funnel: signup → workspace → issue](https://us.posthog.com/project/478904/insights/PTOjuJzu)
- **Insight**: [Agent & skill ecosystem growth](https://us.posthog.com/project/478904/insights/nPmcyS9R)
- **Insight**: [Automation create-to-trigger rate](https://us.posthog.com/project/478904/insights/Xuw5ChiT)

## Verify before merging

- [ ] Run a full production build (the wizard only verified the files it touched) and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite — call sites that were rewritten or instrumented may need updated mocks or fixtures.
- [ ] Add `VITE_PUBLIC_POSTHOG_PROJECT_TOKEN` and `VITE_PUBLIC_POSTHOG_HOST` to `.env.example` and any monorepo/bootstrap scripts so collaborators know what to set.
- [ ] Wire source-map upload (`posthog-cli sourcemap` or your bundler's upload step) into CI so production stack traces de-minify.
- [ ] Confirm the returning-visitor path also calls `identify` — currently `identify` is only called on the login/signup form submit, so returning sessions that skip the auth form (e.g. already have a cookie) will be on anonymous distinct IDs until they explicitly sign in again.

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
