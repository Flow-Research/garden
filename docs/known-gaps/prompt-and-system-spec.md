# Prompt & System Spec

## Gaps

From `docs/core/system-spec.md` sec. 4.2-4.3, 5.1-5.9 and `docs/core/prompt-import-plan.md`.

| Gap | Source | Severity |
|-----|--------|----------|
| Citation and provenance system not built (product support, not just prompt) | System spec sec. 3.9 | Medium |
| Structured clarification tool not built | System spec sec. 4.3 | Low |
| File-delete and destructive-operation gating not built | System spec sec. 4.3 | Medium |
| Observability and eval suites not built | System spec sec. 5.9 | Medium |
| Prompt/version tracking and per-run snapshot storage not built | System spec sec. 5.9 | Medium |
| Tool call tracing not built | System spec sec. 5.9 | Medium |
| Failure taxonomy not defined | System spec sec. 5.9 | Low |
| Hidden built-in skills (pdf, docx, xlsx, pptx) prioritized but not built | Prompt import plan sec. 5.1 | Medium |
| `schedule` skill tracked as planned, not confirmed as installable | Prompt import plan sec. 5.1 | Low |

## Deferred

| Feature | Source |
|---------|--------|
| Visual runtime (HTML/SVG rendering, charts, diagrams, event bridge) | System spec sec. 3.7, 5.7 |
| Browser/web retrieval tools | System spec sec. 5.6 |
| Visualize prompt (kept as build target, not in runtime) | Prompt import plan sec. 4 |
| Plugin/connector discovery UX | System spec sec. 4.3 |
| Explicit TODO/progress tool surfaced in product | System spec sec. 4.3 |

## Current Prompt State

Imported into Garden prompt (from `docs/core/prompt-import-plan.md` sec. 2.1):
- Refusal handling, tone/formatting, evenhandedness, criticism response
- Function call instructions, injection defense, security rules, privacy, action types

Replaced with Cloudflare-native runtime (sec. 2.2):
- Tool definitions, skill inventory, workspace/filesystem rules, runtime reminder

Omitted for now (sec. 2.3):
- Vendor product copy, knowledge cutoff, election info
- Browser/plugin/MCP surfaces Garden doesn't expose yet
- Visualize prompt (no renderer exists)
