# Database load test

Goal: add a rerunnable PostgreSQL load suite that seeds real Garden table
relationships at 10x, 100x, and 1000x, runs route-shaped queries, profiles the
slow path, applies one schema fix, and writes statistical results plus a chart.

- [x] Ground the current schema and route-shaped query paths.
- [x] Add the issue-list order index in the Drizzle schema and migration.
- [x] Add the isolated load harness and the SVG report writer.
- [x] Add the maintainer feature document and package command.
- [x] Run baseline and after measurements with seven paired samples.
- [x] Review the generated report, checks, and final diff.

Data shape:

- One isolated workspace with scaled users, agents, teams, issues, comments,
  runs, run events, work products, inbox items, threads, automations, and
  skills.
- Relationship keys use deterministic UUIDs so two database copies contain the
  same rows.
- The baseline copy has the candidate index removed.
- The after copy has the candidate index applied.

Measurement contract:

- Warm each query once before timed samples.
- Run seven paired samples per query and scale.
- Randomize before or after order inside each pair with a deterministic seed.
- Consume row counts and full row-multiset checksums. Count failures.
- Record median, p95, range, paired bootstrap confidence interval, and a
  two-sided sign-flip p-value.
- Run `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` outside timed samples.
- Save JSON and SVG artifacts under `.audit/db-load-test/`.

Non-goals:

- Do not load the configured Garden database.
- Do not measure HTTP, Cloudflare Workers, or external connectors.
- Do not add a general benchmark framework.
