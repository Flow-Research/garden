# UI & Product

## Gaps

| Gap | Source | Severity |
|-----|--------|----------|
| Keyboard shortcuts not comprehensive (ad-hoc only, no centralized registry) | PRD Phase 4, design doc sec. 7 | Low |
| Audit log UI not built (DB audit infra exists) | PRD Phase 4 | Low |
| Pricing + billing integration not built | PRD Phase 4 | Medium |

## Needs Work

| Item | State | Evidence |
|------|-------|----------|
| Onboarding wizard | Exists but incomplete | `apps/web/src/features/onboarding/onboarding-wizard.tsx` — steps scaffolded, needs polish |
| Command palette (cmdk) | Exists but incomplete | `apps/web/src/features/search/search-command.tsx` — basic search works, needs refinement |

## Done

| Item | Evidence |
|------|----------|
| Tab-preserving panel system via FlexLayout (replaces `<Activity>` pattern) | `apps/web/src/components/shell/workspace-dock.tsx` — pinning, splitting, state persistence |
| AI Elements wired into app | `@cloudflare/ai-chat` used in `chat-runtime-provider.tsx`, `@cloudflare/sandbox` wired in `server.ts`, active in agent-interaction-screen |
| Org chart view | `apps/web/src/features/agents/components/org-chart.tsx` |
| Connector permission toggles UI (Auto/Allow/Ask) | `apps/web/src/features/connections/components/connections-page.tsx` |
| Ad-hoc keyboard shortcuts | Cmd/Ctrl+K (search), Cmd+, (settings), Esc (close dialogs), number keys for structured inputs |

## Deferred

| Feature | Source |
|---------|--------|
| Custom category icons (using Lucide for now) | Design doc sec. 6 |
| Gamification / mastery badges | Design doc sec. 6, 11 |
