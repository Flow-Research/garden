# Prompt & System Spec

## Gaps

From `docs/core/system-spec.md` sec. 4.2-4.3, 5.1-5.9 and `docs/core/prompt-import-plan.md`.

| Gap | Source | Severity |
|-----|--------|----------|
| General citation and provenance system is not built across all tools and claims. Document citations exist through `findInDocument`, but there is no product-wide provenance layer. | System spec sec. 3.9; `packages/agent-runtime/src/documents/document-tools.ts`, `apps/web/src/features/chat/components/chat-message-parts.tsx` | Medium |
| Structured clarification is partial: chat has `askUserInput`, issue runs have `ask_question`, but there is no unified product-wide clarification contract across chat, issues, automations, and external messengers | System spec sec. 4.3; `chat-sub-agent-tools.ts`, `agent-tools/ask-question.ts` | Low |
| File-delete and destructive-operation gating not built | System spec sec. 4.3 | Medium |
| Observability and eval suites not built | System spec sec. 5.9 | Medium |
| Prompt/version tracking and per-run snapshot storage not built | System spec sec. 5.9 | Medium |
| Tool call tracing is partial: issue and automation runs record tool events/traces, but chat has no consolidated tool trace UI/export | System spec sec. 5.9; `issue-run-sub-agent.ts`, `automation-run-sub-agent.ts` | Medium |
| Failure taxonomy not defined | System spec sec. 5.9 | Low |
| `schedule` skill tracked as planned, not confirmed as installable | Prompt import plan sec. 5.1 | Low |

## Deferred

| Feature | Source |
|---------|--------|
| Visual runtime (HTML/SVG rendering, charts, diagrams, event bridge) | System spec sec. 3.7, 5.7 |
| Browser/web retrieval tools for general chat/issue runtime | System spec sec. 5.6; automation has gated `createBrowserTools` only |
| Visualize prompt (kept as build target, not in runtime) | Prompt import plan sec. 4 |
| Plugin/connector discovery UX | System spec sec. 4.3 |
| Explicit TODO/progress tool surfaced in product | System spec sec. 4.3 |

## Current Prompt State

Built now:
- Built-in document skills for `pdf`, `docx`, `xlsx`, and `pptx` are defined in `packages/agent-runtime/src/bundled-skills.ts` and advertised in the foundation prompt as on-demand skills.
- Document citation annotations from `findInDocument` render as clickable inline citations in chat.

Imported into Garden prompt (from `docs/core/prompt-import-plan.md` sec. 2.1):
- Refusal handling, tone/formatting, evenhandedness, criticism response
- Function call instructions, injection defense, security rules, privacy, action types

Replaced with Cloudflare-native runtime (sec. 2.2):
- Tool definitions, skill inventory, workspace/filesystem rules, runtime reminder

Omitted for now (sec. 2.3):
- Vendor product copy, knowledge cutoff, election info
- Browser/plugin/MCP surfaces Garden doesn't expose yet
- Visualize prompt (no renderer exists)
