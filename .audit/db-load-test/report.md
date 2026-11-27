# Garden database load test

Generated 2026-11-27T01:48:37.369Z against PostgreSQL 16.15.

The suite seeded one isolated workspace at 10x. It ran 7 paired samples per query and scale, with 4 concurrent calls in each sample. It used one warmup call per side. The baseline copy had no candidate index. The treatment copy added `issue_workspace_updated_order_idx`.

## Results

| Scale | Query | Before median | After median | Change | Sign-flip p | Verdict |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 10x | Issue list | 8.59 ms | 5.49 ms | -36.1% | 0.0625 | no measurable difference |
| 10x | Issue search | 6.46 ms | 6.15 ms | -4.9% | 0.3750 | no measurable difference |
| 10x | Issue timeline | 10.95 ms | 13.26 ms | 21.1% | 0.4688 | no measurable difference |
| 10x | Inbox source queries | 81.81 ms | 121.27 ms | 48.2% | 0.5938 | no measurable difference |
| 10x | Agent activity | 7.05 ms | 6.05 ms | -14.2% | 0.1719 | no measurable difference |
| 10x | Chat thread list | 6.49 ms | 7.60 ms | 17.1% | 0.8438 | no measurable difference |
| 10x | Automation run history | 6.28 ms | 3.59 ms | -42.9% | 0.5938 | no measurable difference |
| 10x | Assigned skill catalog | 4.21 ms | 6.06 ms | 43.9% | 0.4531 | no measurable difference |

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
