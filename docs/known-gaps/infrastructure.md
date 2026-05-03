# Infrastructure

## Gaps

| Gap | Source | Severity |
|-----|--------|----------|
| Pre-commit gates (oxlint, oxfmt, tsc, vitest) not wired via lefthook | Technical doc sec. 14 | Medium |
| E2E tests (Playwright) not written | Technical doc sec. 14 | Medium |
| Sentry error tracking not wired (Workers SDK or React SDK) | Technical doc sec. 13 | Medium |
| Staging environment not set up (CF Workers preview + Neon staging branch) | Technical doc sec. 10.4 | Medium |
| Doc validation pre-commit check not built | PRD sec. 10A | Low |
| Health check route (`/api/health`) not built | Technical doc sec. 13 | Low |
| Custom observability dashboard (recharts) not built | Technical doc sec. 13 | Low |
| Cloudflare Analytics Engine counters not wired for connector metrics | Connectors implementation plan Phase 11 | Low |

## Done

| Item | Evidence |
|------|----------|
| CI/GitHub Actions pipeline | `.github/workflows/ci.yml` — lint, typecheck, test, build |
| Connector CI workflow | `.github/workflows/connectors.yml` — connector-specific validation |

## Target Pre-Commit Gates (from technical doc, not wired yet)

1. `oxlint` — lint changed files
2. `oxfmt --check` — format check
3. `tsc --noEmit` — type check
4. `vitest run --changed` — run tests affected by changed files
