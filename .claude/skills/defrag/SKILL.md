---
name: defrag
description: Scan the codebase for fragmentation — duplicate components, inconsistent patterns, drifted utilities, reinvented wheels, orphaned files — and consolidate. Load when the user says "defrag," "run defrag," "clean up the codebase," "find duplicates," or before a major merge. Also load proactively after large agent-authored changes to catch fragmentation before it compounds.
---

# Defrag

Large, fast-moving codebases tend to accumulate parallel versions of things that already exist: a new `<Button>` wrapper when one exists in `packages/ui`, a new date formatter when `packages/core/utils` already has one, or a near-duplicate modal that differs only in spacing. This skill finds and fixes that.

## When to invoke

- Before a release merge
- After any PR that touched more than ~10 files
- Weekly, as a scheduled maintenance pass
- Whenever the user says "defrag," "clean up," "find duplicates"

## Scope — what counts as fragmentation

1. **Duplicate components** — two or more components that render the same UI with trivial visual differences. Common signatures: `<FooButton>` and `<BarButton>` where one wraps `<Button>` from `packages/ui` and the other reimplements styling.
2. **Reinvented utilities** — functions with the same purpose as one that already exists in `packages/core/utils`, `packages/core/lib`, or `packages/ui/lib`. Signature: same input/output shape, different name.
3. **Inconsistent patterns** — the codebase has a canonical way to do something (e.g. calling the API via `apiClient` from `packages/core/api/client.ts`) but some files use a different pattern (e.g. raw `fetch`). Flag drift.
4. **Orphaned files** — files not imported anywhere, exports with no callers. Removal candidates.
5. **Style drift** — CSS values hardcoded instead of using tokens from `packages/ui/styles/tokens.css`; class combinations that bypass the token system.
6. **Type shape drift** — the same domain entity (e.g. `Issue`, `Agent`) declared in multiple type files with subtly different shapes.
7. **API endpoint drift** — two endpoints doing the same work, or one endpoint reimplemented in a different route file.

## Process

### 1. Scope the scan

Ask the user or infer from git: scan the whole repo, or a specific package/directory?

Default scope priority:
- `packages/ui/` — most at risk for duplicate components
- `packages/views/` — most at risk for duplicate page sub-components
- `packages/core/` — most at risk for reinvented utilities
- `apps/*/` — most at risk for inconsistent patterns

### 2. Build an inventory

For the scope, produce:

- **Component inventory** — every React component, with its file path, prop signature (via TypeScript), and rough rendered output. Use `Grep` for `export (function|const) [A-Z]` to find component exports.
- **Utility inventory** — every exported function/const in `lib/` and `utils/` folders, with its type signature.
- **Type inventory** — every exported TypeScript type/interface, with its shape.
- **API call inventory** — every call site of `apiClient.*` and every raw `fetch` call. Flag raw fetches as pattern drift.
- **Style inventory** — grep for hardcoded colors (`#[0-9a-fA-F]{3,8}`), hardcoded pixel values in JSX classes, and usages that bypass `--brand`, `--background`, `--foreground`, etc.

### 3. Cluster and identify duplicates

Group components, utilities, and types by semantic similarity:
- Same prop signature → candidate component duplicate
- Same function signature + same textual purpose (infer from name and usage) → candidate utility duplicate
- Same structural shape across two names → candidate type duplicate

For components: compare the JSX trees structurally, not textually. Two components that both render a button with a label and an icon are duplicates even if the icons differ.

### 4. Report

Output a structured report with the following shape. Write it to `docs/defrag-YYYY-MM-DD.md`:

```markdown
# Defrag report — {{date}}

## Summary
- X duplicate components found
- Y reinvented utilities found
- Z type drifts found
- N orphaned files
- M pattern-drift instances

## Duplicates — components

### Cluster 1: Button-like wrappers
- `packages/ui/components/ui/button.tsx` — canonical
- `packages/views/.../submit-button.tsx` — duplicate (wraps Button with no added behavior)
- `apps/app/.../primary-action.tsx` — duplicate (reimplements styling)

**Suggested consolidation:** delete the duplicates and import `Button` from `packages/ui`. Callers: {{list call sites}}.

[... more clusters ...]

## Reinvented utilities

[... same shape ...]

## Pattern drift

[... same shape ...]

## Orphans

[... list of unimported files ...]
```

### 5. Apply fixes (with user approval)

After the report, ask the user which clusters to fix. For each approved cluster:

1. Identify the canonical version (the one in `packages/ui` or `packages/core` usually wins).
2. Find all call sites of the duplicates.
3. Rewrite the call sites to use the canonical version.
4. Delete the duplicate files.
5. Run the typecheck + lint. Fix any residual issues.
6. Commit with message `defrag: consolidate {{cluster-name}}`.

Do not apply fixes unattended. Always surface the report first and wait for approval, even for what seem like obvious wins.

### 6. Quality gates that should already be running

Defrag's job is easier when these are in place:

- **No hardcoded colors or spacing** — enforced via a Biome rule or ESLint custom rule targeting hex and px-in-className patterns
- **No raw fetch in app code** — enforced via a lint rule allowlisting only `packages/core/api/**`
- **Single source of truth for domain types** — all shared types live in `packages/core/types/` and are re-exported; duplicate local definitions are lint-flagged

## Anti-patterns

- **Don't auto-delete anything.** Always surface the report first.
- **Don't collapse visually different components just because they have similar prop signatures.** A confirmation modal and a form modal look different on purpose.
- **Don't consolidate across package boundaries when packages are intentionally isolated.** Two utilities in different packages can be intentional.

## Output format

Always write the report to `docs/defrag-YYYY-MM-DD.md` so it's reviewable before fixes run. Append a short summary to the user in chat: counts + top 3 clusters + link to the full report.
