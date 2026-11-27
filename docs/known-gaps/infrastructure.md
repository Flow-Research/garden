# Infrastructure

## Active gap

| Issue  | Gap                                                                                                                                                                           | Evidence                                                               | Priority |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------- |
| FLO-32 | Garden lacks a stable `/api/health` contract and beta-critical smoke suite covering login/workspace, chat, issue run, automation run, and document artifacts against staging. | `apps/web/src/server.ts`, `.github/workflows/ci.yml`, `alchemy.run.ts` | High     |

The [Garden evaluation system design](../features/evaluation-system-design.md)
defines how repeatable agent tasks can extend this smoke coverage. The design
does not close FLO-32. Garden still needs the implemented staging checks and
their recorded results.

## Done

| Item                             | Evidence                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| CI/GitHub Actions pipeline       | `.github/workflows/ci.yml` runs repository checks, connector coverage, and migrations. |
| Client and Worker error tracking | PostHog client capture and Worker exception reporting are wired in the web runtime. |
| Staging resources                | `alchemy.run.ts` defines deployed Cloudflare and Neon staging resources.            |

## Deferred maintenance

Pre-commit hooks, documentation validation hooks, and a custom observability dashboard are useful maintenance work, but they are not current beta-blocking Flow Research issues. Add them only when measured workflow or operational pain justifies them.
