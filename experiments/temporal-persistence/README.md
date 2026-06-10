# Temporal Persistence Bottleneck Experiment

Goal: find the highest sustainable dev-box throughput before Temporal persistence becomes the bottleneck.

The experiment is intentionally read-only for measurement. Tuning changes are applied one at a time between identical runs.

## Controlled Stage Matrix

Run the webhook scenario with only the `medium` stage enabled and all other stages disabled. The k6 scenario builder reliably preserves `medium` when earlier stages are zero-duration, so the experiment uses `medium` as the active controlled stage even for low-rate runs.

| Run | Rate | Duration | Purpose |
| --- | ---: | --- | --- |
| A | 25 rps | 2m | Confirm clean baseline. |
| B | 50 rps | 2m | Find first persistence latency slope. |
| C | 100 rps | 2m | Reproduce current pressure zone. |

## Clean-State Requirement

Before comparing runs, clear old pressure. A valid run starts with:

- `temporal workflow count --query 'ExecutionStatus="Running"'` close to `0`.
- `jetstream_consumer_num_pending{consumer_name="workflow-triggers"}` close to `0`.
- `workflow-orchestrator` workflow/activity backlog close to `0`.

If the cluster is still draining yesterday's run, comparisons are invalid.

## Commands

Capture metrics before and after each run:

```bash
./experiments/temporal-persistence/capture.sh pre-a-25rps
./experiments/temporal-persistence/run-stage.sh a-25rps 25 2m
./experiments/temporal-persistence/capture.sh post-a-25rps
```

Repeat for `50` and `100` rps.

## Metrics That Decide Bottleneck

Temporal persistence is the bottleneck when the first sharp degradation appears in these signals while upstream ingress still succeeds:

- `persistence_latency_bucket` p95/p99 by operation.
- `persistence_error_with_type` by operation.
- `postgres-temporal-1` CPU and memory.
- `cnpg_pg_stat_database_xact_commit{datname="temporal"}`.
- `cnpg_pg_stat_database_tup_inserted{datname="temporal"}`.
- `cnpg_pg_stat_database_tup_updated{datname="temporal"}`.
- `cnpg_pg_stat_database_blk_write_time{datname="temporal"}`.
- `workflow-orchestrator` task queue add rate, dispatch rate, and backlog.
- `workflow-triggers` pending and ack-pending counts.

## Tuning Rule

Apply only one change between series. The first tuning candidate is to reduce workflow-start pressure, not increase workers:

- keep `WORKFLOW_TRIGGER_CONCURRENCY=2`;
- cap `workflow-service-worker` lower than `8` replicas during the test;
- keep workflow workers high enough to drain but avoid maxing all pressure sources at once.

Compare before/after with the same rate matrix.
