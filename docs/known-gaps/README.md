# Known Gaps

Extracted from docs, code TODOs, and cross-referenced against the current codebase.

Last updated: 2026-06-08

## Index

| File | Area | Key gaps |
|------|------|----------|
| [auth-and-access.md](./auth-and-access.md) | Security, auth, workspace isolation | Origin and CSRF posture need final ship review |
| [realtime-sync.md](./realtime-sync.md) | App-wide realtime bus, live cache sync | No workspace-wide WS publisher/binding yet; issue UI uses polling |
| [connectors.md](./connectors.md) | MCP proxy, OAuth, tools, audit | Catalog sync, audit UI, MCP session-state ownership; stable SDK server ids now adopted |
| [agent-runtime.md](./agent-runtime.md) | Prompt assembly, shared runtime resources, connector grants | Chat keying, durable submissions, and context overflow are resolved; parent-backed sharing and richer memory remain |
| [issue-flow.md](./issue-flow.md) | Runs, work products, inbox, issue/chat linking | Small product/data gaps after core issue-run runtime shipped |
| [automations.md](./automations.md) | Scheduled/manual automation runs, triggers, runtime ledger | Queue concurrency, trigger hardening, richer usage/audit surfaces |
| [document-artifacts.md](./document-artifacts.md) | DOCX, edits, citations, Review Grid | Existing-document picker; no global workspace artifact/document bucket yet |
| [prompt-and-system-spec.md](./prompt-and-system-spec.md) | Visual runtime, browser tools, citations, evals | Observability, general provenance, schedule skill; clarification/tracing are partial |
| [ui-and-product.md](./ui-and-product.md) | Tabs, onboarding, billing, AI Elements | Billing + audit log UI remain |
| [infrastructure.md](./infrastructure.md) | CI, hooks, tests, error tracking, staging | Pre-commit hooks, E2E, Sentry, staging |
| [deferred.md](./deferred.md) | Post-MVP decisions, open design questions | Memory, marketplace, workspace-level realtime, enterprise features |
