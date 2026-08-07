# Prompt & System Spec

## Active gap

From `docs/core/system-spec.md` sec. 5.9 and current runtime storage.

| Issue  | Gap                                                                                                                                                                                                | Evidence                                                                                                                                            | Priority |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FLO-37 | Store prompt/config versions and bounded context snapshots, define a shared failure taxonomy, expose secret-safe cross-surface traces, and add regression evals for critical prompt/tool behavior. | Issue and automation runs store usage and tool events, but no coherent snapshot, trace, or evaluation contract spans chat, issues, and automations. | Medium   |

Product-wide provenance, unified clarification, destructive-file gating, browser tools, visual runtime, and schedule-skill work remain deferred until a concrete workflow requires them.

## Deferred

| Feature                                                             | Source                                                               |
| ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Visual runtime (HTML/SVG rendering, charts, diagrams, event bridge) | System spec sec. 3.7, 5.7                                            |
| Browser/web retrieval tools for general chat/issue runtime          | System spec sec. 5.6; automation has gated `createBrowserTools` only |
| Visualize prompt (kept as build target, not in runtime)             | System spec sec. 5.7                                                 |
| Plugin/connector discovery UX                                       | System spec sec. 4.3                                                 |
| Explicit TODO/progress tool surfaced in product                     | System spec sec. 4.3                                                 |

## Current Prompt State

Built now:

- Built-in document skills for `pdf`, `docx`, `xlsx`, and `pptx` are defined in `packages/agent-runtime/src/bundled-skills.ts` and advertised in the foundation prompt as on-demand skills.
- Document citation annotations from `findInDocument` render as clickable inline citations in chat.

Imported into Garden prompt:

- Refusal handling, tone/formatting, evenhandedness, criticism response
- Function call instructions, injection defense, security rules, privacy, action types

Replaced with Cloudflare-native runtime:

- Tool definitions, skill inventory, workspace/filesystem rules, runtime reminder

Omitted for now:

- Vendor product copy, knowledge cutoff, election info
- Browser/plugin/MCP surfaces Garden doesn't expose yet
- Visualize prompt (no renderer exists)
