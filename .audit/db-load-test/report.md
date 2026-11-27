# Garden database load test

Generated 2026-11-27T01:57:51.820Z against PostgreSQL 16.15.

The suite seeded one isolated workspace at 10x. It ran 7 paired samples per query and scale, with 4 concurrent calls in each sample. It used one warmup call per side. The baseline copy had no candidate index. The treatment copy added `issue_workspace_updated_order_idx`.

## Results

| Scale | Query | Before median | After median | Change | Sign-flip p | Verdict |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 10x | Issue list | 1.98 ms | 1.83 ms | -7.4% | 0.5156 | no measurable difference |
| 10x | Issue search | 5.22 ms | 5.12 ms | -1.8% | 0.6250 | no measurable difference |
| 10x | Issue timeline | 3.08 ms | 3.04 ms | -1.4% | 0.4531 | no measurable difference |
| 10x | Inbox source queries | 18.04 ms | 20.42 ms | 13.2% | 0.4375 | no measurable difference |
| 10x | Agent activity | 2.16 ms | 1.71 ms | -20.9% | 0.6406 | no measurable difference |
| 10x | Chat thread list | 0.83 ms | 0.83 ms | -0.1% | 0.5000 | no measurable difference |
| 10x | Automation run history | 0.64 ms | 0.71 ms | 9.9% | 0.2031 | no measurable difference |
| 10x | Assigned skill catalog | 1.07 ms | 0.86 ms | -19.7% | 0.8281 | no measurable difference |

## Query plans

The plan columns show node, index, and sort method. Buffer columns show shared
hit/read blocks. The candidate index appeared in 1 of 1 issue-list treatment plans. An issue-list result is inconclusive when its treatment plan does not use the candidate index.

| Scale | Query | Before plan | After plan | Before buffers | After buffers |
| --- | --- | --- | --- | ---: | ---: |
| 10x | Issue list | Limit / none / top-N heapsort | Limit / issue_workspace_updated_order_idx / none | 29/0 | 13/0 |
| 10x | Issue search | Sort / none / quicksort | Sort / none / quicksort | 29/0 | 29/0 |
| 10x | Issue timeline | Nested Loop / issue_run_event_issue_idx / none | Nested Loop / issue_run_event_issue_idx / none | 39/0 | 39/0 |
| 10x | Inbox source queries | Seq Scan / none / none | Seq Scan / none / none | 29/0 | 29/0 |
| 10x | Agent activity | Limit / none / quicksort | Limit / none / quicksort | 9/0 | 9/0 |

The confidence interval uses paired bootstrap resampling at 95%. The sign-flip test uses a 0.05 significance level. A result is inconclusive when a sample errors or fewer than five paired samples remain.

The query rows were consumed and before and after full row-multiset checksums were compared. The comparison ignores row order inside each result set because the search query has non-unique timestamp ties. Profiles use `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` outside the timed samples. The profile is diagnostic evidence, not part of the latency number.

The benchmark does not measure HTTP, Workers, external connectors, network latency, or production traffic. A separate approved experiment is needed before making a capacity promise.
