# UI & Product

## Active gap

| Issue | Gap | Evidence | Priority |
| --- | --- | --- | --- |
| FLO-34 | New testers need a shorter path from signup/workspace creation to a useful agent action, plus clear explanations and recovery actions for failed runs, missing workspace state, expired sessions, invitations, and reconnects. | `apps/web/src/features/auth`, `apps/web/src/features/onboarding`, `apps/web/src/features/issues` | Medium |

## Done

| Item | Evidence |
| --- | --- |
| Tab-preserving panel system via FlexLayout | `apps/web/src/components/shell/workspace-dock.tsx` supports pinning, splitting, and persisted state. |
| AI runtime surfaces wired into the app | `@cloudflare/ai-chat` is used by chat; Sandbox bindings are wired through the web Worker. |
| Organization chart | `apps/web/src/features/agents/components/org-chart.tsx` |
| Connector permission toggles | `apps/web/src/features/connections/components/connections-page.tsx` |
| Core keyboard shortcuts | Cmd/Ctrl+K, Cmd+,, Escape, and structured-input number keys. |

## Deferred

Billing, marketplace work, audit-log UI, a centralized shortcut registry, custom category icons, and gamification are outside the current beta issue set.
