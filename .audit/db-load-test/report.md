# Garden database load test

Generated 2026-11-05T10:17:20.807Z against PostgreSQL 16.14.

The suite seeded one isolated workspace at 10x, 100x, 1000x. It ran 7 paired samples per query and scale, with 4 concurrent calls in each sample. It used one warmup call per side. The before copy removed `issue_workspace_updated_order_idx`. The after copy added it.

## Results

| Scale | Query | Before median | After median | Change | Sign-flip p | Verdict |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 10x | Issue list | 62.62 ms | 79.07 ms | 26.3% | 0.7188 | no measurable difference |
| 10x | Issue search | 102.64 ms | 51.14 ms | -50.2% | 0.2344 | no measurable difference |
| 10x | Issue timeline | 30.97 ms | 33.19 ms | 7.2% | 0.6406 | no measurable difference |
| 10x | Inbox source queries | 173.99 ms | 174.52 ms | 0.3% | 0.5000 | no measurable difference |
| 10x | Agent activity | 24.95 ms | 23.03 ms | -7.7% | 0.5781 | no measurable difference |
| 10x | Chat thread list | 20.39 ms | 26.08 ms | 27.9% | 0.5625 | no measurable difference |
| 10x | Automation run history | 11.07 ms | 11.57 ms | 4.6% | 0.4688 | no measurable difference |
| 10x | Assigned skill catalog | 14.35 ms | 8.07 ms | -43.8% | 0.5469 | no measurable difference |
| 100x | Issue list | 52.86 ms | 43.25 ms | -18.2% | 0.2031 | no measurable difference |
| 100x | Issue search | 371.94 ms | 214.85 ms | -42.2% | 0.1406 | no measurable difference |
| 100x | Issue timeline | 93.17 ms | 167.99 ms | 80.3% | 0.0781 | no measurable difference |
| 100x | Inbox source queries | 2430.40 ms | 2756.58 ms | 13.4% | 0.3438 | no measurable difference |
| 100x | Agent activity | 54.91 ms | 37.76 ms | -31.2% | 0.8125 | no measurable difference |
| 100x | Chat thread list | 40.68 ms | 49.44 ms | 21.5% | 0.8438 | no measurable difference |
| 100x | Automation run history | 49.08 ms | 35.65 ms | -27.4% | 0.6875 | no measurable difference |
| 100x | Assigned skill catalog | 60.16 ms | 46.00 ms | -23.5% | 0.5313 | no measurable difference |
| 1000x | Issue list | 934.95 ms | 914.02 ms | -2.2% | 0.5625 | no measurable difference |
| 1000x | Issue search | 6939.37 ms | 7912.97 ms | 14.0% | 0.7813 | no measurable difference |
| 1000x | Issue timeline | 41.50 ms | 24.84 ms | -40.1% | 0.7969 | no measurable difference |
| 1000x | Inbox source queries | 29250.74 ms | 24063.44 ms | -17.7% | 0.9375 | no measurable difference |
| 1000x | Agent activity | 132.22 ms | 95.74 ms | -27.6% | 0.8438 | no measurable difference |
| 1000x | Chat thread list | 21.07 ms | 29.16 ms | 38.4% | 0.1094 | no measurable difference |
| 1000x | Automation run history | 29.69 ms | 45.70 ms | 53.9% | 0.3438 | no measurable difference |
| 1000x | Assigned skill catalog | 24.06 ms | 26.67 ms | 10.9% | 0.7969 | no measurable difference |

## Query plans

The plan columns show node, index, and sort method. Buffer columns show shared
hit/read blocks. The candidate index did not appear in the captured plans.

| Scale | Query | Before plan | After plan | Before buffers | After buffers |
| --- | --- | --- | --- | ---: | ---: |
| 10x | Issue list | Limit / none / top-N heapsort | Limit / none / top-N heapsort | 29/0 | 29/0 |
| 10x | Issue search | Sort / none / quicksort | Sort / none / quicksort | 29/0 | 29/0 |
| 10x | Issue timeline | Nested Loop / issue_run_event_issue_idx / none | Nested Loop / issue_run_event_issue_idx / none | 39/0 | 39/0 |
| 10x | Inbox source queries | Seq Scan / none / none | Seq Scan / none / none | 29/0 | 29/0 |
| 10x | Agent activity | Limit / none / quicksort | Limit / none / quicksort | 9/0 | 9/0 |
| 100x | Issue list | Limit / none / top-N heapsort | Limit / none / top-N heapsort | 273/21 | 300/0 |
| 100x | Issue search | Sort / none / quicksort | Sort / none / quicksort | 294/0 | 294/0 |
| 100x | Issue timeline | Nested Loop / issue_run_event_issue_idx / none | Nested Loop / issue_run_event_issue_idx / none | 34/6 | 33/7 |
| 100x | Inbox source queries | Seq Scan / none / none | Seq Scan / none / none | 294/0 | 294/0 |
| 100x | Agent activity | Limit / none / quicksort | Limit / none / quicksort | 78/0 | 78/0 |
| 1000x | Issue list | Limit / none / top-N heapsort | Limit / none / top-N heapsort | 114/2877 | 2986/0 |
| 1000x | Issue search | Sort / none / quicksort | Sort / none / quicksort | 2941/0 | 2941/0 |
| 1000x | Issue timeline | Nested Loop / issue_run_event_issue_idx / none | Nested Loop / issue_run_event_issue_idx / none | 40/12 | 40/12 |
| 1000x | Inbox source queries | Seq Scan / none / none | Seq Scan / none / none | 2941/0 | 2941/0 |
| 1000x | Agent activity | Limit / none / quicksort | Limit / none / quicksort | 4/770 | 4/770 |

The confidence interval uses paired bootstrap resampling at 95%. The sign-flip test uses a 0.05 significance level. A result is inconclusive when a sample errors or fewer than five paired samples remain.

The query rows were consumed and before and after full row-multiset checksums were compared. The comparison ignores row order inside each result set because the search query has non-unique timestamp ties. Profiles use `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` outside the timed samples. The profile is diagnostic evidence, not part of the latency number.

The benchmark does not measure HTTP, Workers, external connectors, network latency, or production traffic. Repeat it against a production-sized clone before making a capacity promise.
