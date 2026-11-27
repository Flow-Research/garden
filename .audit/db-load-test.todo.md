# Database load test

Goal: add a rerunnable PostgreSQL load suite that seeds real Garden table
relationships at 10x, 100x, and 1000x, runs route-shaped queries, profiles the
slow path, applies one candidate index in the treatment copy, and writes statistical results plus a chart.

- [x] Ground the current schema and route-shaped query paths.
- [x] Add the candidate issue-list index only in the treatment database.
- [x] Add the isolated load harness and the SVG report writer.
- [x] Add the maintainer feature document and package command.
- [x] Run the first baseline and after measurements with seven paired samples.
- [x] Review the generated report, checks, and final diff.

Data shape:

- One isolated workspace with scaled users, agents, teams, issues, comments,
  runs, run events, work products, inbox items, threads, automations, and
  skills.
- Relationship keys use deterministic UUIDs so two database copies contain the
  same rows.
- The baseline copy has no candidate index.
- The after copy has the candidate index applied.

Measurement contract:

- Warm each query once before timed samples.
- Run seven paired samples per query and scale.
- Alternate which database runs first between consecutive pairs, using a deterministic first side.
- Consume row counts and full row-multiset checksums. Count failures.
- Record median, p95, range, paired bootstrap confidence interval, and a
  two-sided sign-flip p-value.
- Run `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` outside timed samples.
- Save JSON, Markdown, and SVG artifacts under a local temporary directory.

Non-goals:

- Do not load the configured Garden database.
- Do not measure HTTP, Cloudflare Workers, or external connectors.
- Do not add a general benchmark framework.
