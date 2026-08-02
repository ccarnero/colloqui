# SKB Operational Runbook

*SKB is a module inside `agent-admin-service` (`src/modules/structured-kb/`, `SERVICE_MODE=api|worker`) — there is no standalone SKB service.*

> Operational procedures for the Structured Knowledge Base service —
> ingestion, querying, monitoring, and incident response.

---

## Table of Contents

1. [Service Architecture](#1-service-architecture)
2. [Restarting the Ingestion Worker](#2-restarting-the-ingestion-worker)
3. [Checking Stuck Files](#3-checking-stuck-files)
4. [Manually Triggering Re-ingestion](#4-manually-triggering-re-ingestion)
5. [Debugging Query Failures](#5-debugging-query-failures)
6. [Monitoring via Grafana](#6-monitoring-via-grafana)
7. [Common Issues and Fixes](#7-common-issues-and-fixes)
8. [Support Contacts](#8-support-contacts)

---

## 1. Service Architecture

```
Admin Console → api-gateway (AdminStructuredKBController)
    → POST /admin/structured-kb/containers/:id/files → proxy to agent-admin-service
    → Publishes NATS event on per-tenant INGRESS-<tenant> stream (skb_file_ingestion.v1)
    → SKBIngestionWorkerService (SERVICE_MODE=worker)
        → Parse file → LLM schema analysis → Batch INSERT rows
    → SKBQueryService (SERVICE_MODE=api)
        → POST /admin/structured-kb/containers/:id/query
        → NL query → LLM translation → Safe SQL execution
```

**Service modes:**
- `SERVICE_MODE=api` — HTTP API server (controller only)
- `SERVICE_MODE=worker` — NATS consumer (ingestion pipeline + watchdog)
- Both can run simultaneously on different pods.

> **Re-verified 2026-08-02 — the old "known limitations" list is obsolete.** The
> upload route (`SKBContainersController.uploadFile`) is implemented and publishes
> the ingestion event; file-status updates target `skb_files` (created by
> `schema-initializer.ts`); `insertRows()` has an honest signature;
> `findProcessingFilesOlderThan` really iterates
> `connectionManager.getKnownTenantIds()` and queries `skb_files`; and query
> history IS recorded — `SKBQueryService.recordQueryHistory()` calls
> `SKBQueryHistoryService.recordQuery()` on both the success and the error path
> (fire-and-forget, failures logged at `warn`).
>
> Two real gaps remain: `GET/DELETE .../files*` and `GET .../files/:fileId/schema`
> have no routes at all, and none of the `skb_*` Prometheus metrics in §6 exist.

**Key tables:**
- `skb_containers` — Container metadata and status
- `skb_files` — Per-file status tracking
- `skb_schemas` — LLM-analyzed column schemas
- `skb_rows` — Actual data (JSONB)
- `skb_query_history` — Query audit log

---

## 2. Restarting the Ingestion Worker

### Kubernetes

Two workloads run this image, in the **platform** namespace
(`platform-services-dev`) — NOT a tenant namespace, which holds only that
tenant's datastores:

| Workload | Kind | `SERVICE_MODE` | Runs SKB ingestion? |
|---|---|---|---|
| `agent-admin-service` | Knative `Service` (`knative/services/base/agent-admin-service.yaml`) | `api` | no — HTTP + query only |
| `agent-admin-service-worker` | plain `apps/v1` `Deployment` (`agent-admin-service-worker.yaml`) | `worker` | yes |

Restart the **worker**; the label selector is `app.kubernetes.io/name`, not `app`:

```bash
kubectl get pods -l app.kubernetes.io/name=agent-admin-service-worker -n platform-services-dev

# Rolling restart (preferred — it is a plain Deployment)
kubectl rollout restart deployment/agent-admin-service-worker -n platform-services-dev
kubectl rollout status  deployment/agent-admin-service-worker -n platform-services-dev

# Or bounce a single pod
kubectl delete pod <worker-pod-name> -n platform-services-dev
```

Do **not** `kubectl scale deployment agent-admin-service`: that one is a Knative
Service whose Deployment is owned by the KPA, which reverts any manual replica
change.

### Verify startup

```bash
kubectl logs -l app.kubernetes.io/name=agent-admin-service-worker \
  -n platform-services-dev | grep -i "skb"
```

### NATS consumer health

The worker creates one durable consumer (`skb-ingestion-worker`) on each per-tenant
`INGRESS-<tenant>` stream. Check each stream individually.

```bash
# List all tenant ingress streams
nats stream ls | grep '^INGRESS-'

# Check consumer exists and is healthy on a specific tenant stream
nats consumer info INGRESS-<TENANT> skb-ingestion-worker

# Check for redelivered messages (indicates processing failures)
nats consumer info INGRESS-<TENANT> skb-ingestion-worker | grep Redelivered
```

> **Orphaned SKB-INGESTION stream**: clusters provisioned before this fix may still carry
> a `SKB-INGESTION` stream. Its subjects overlap the per-tenant `INGRESS-*` subjects and
> will cause _"subjects overlap with an existing stream"_ errors on new tenant provisioning.
> Remove it with:
> ```bash
> nats stream rm SKB-INGESTION -f
> ```

---

## 3. Checking Stuck Files

`SKBIngestionWatchdogService` detects files stuck in `processing`
(`DEFAULT_STUCK_THRESHOLD_MINUTES = 10`, swept every
`DEFAULT_CHECK_INTERVAL_MS = 5 min`) and runs only when `SERVICE_MODE=worker`.
Its lookup, `SKBContainersRepository.findProcessingFilesOlderThan`, iterates
every tenant the process has an open connection for
(`connectionManager.getKnownTenantIds()`) — so a tenant whose pool has not been
opened yet in this pod is invisible to the sweep. Use the manual checks below to
cover those.

When it does find one, it acts: each stuck file is reset via
`updateFileStatus(..., "failed", { error: "File stuck in 'processing' for more
than 10 minutes — watchdog reset" })`, and every affected container is then
recomputed with `updateStatus(tenantId, containerId)`. Both steps are per-file
try/catch, so one failure does not abort the sweep.

### Manual check

```sql
-- Find files stuck in processing for more than 10 minutes
SELECT id, container_id, tenant_id, original_name, status, updated_at
FROM skb_files
WHERE status = 'processing'
  AND updated_at < NOW() - INTERVAL '10 minutes'
ORDER BY updated_at ASC;
```

### Check container status consistency

```sql
-- Find containers that should be 'ready' but aren't
SELECT c.id, c.name, c.status,
  (SELECT COUNT(*) FROM skb_files f WHERE f.container_id = c.id AND f.status = 'processing') AS processing_count,
  (SELECT COUNT(*) FROM skb_files f WHERE f.container_id = c.id AND f.status = 'completed') AS completed_count,
  (SELECT COUNT(*) FROM skb_files f WHERE f.container_id = c.id AND f.status = 'failed') AS failed_count
FROM skb_containers c
WHERE c.status != 'ready' AND c.is_active = true;
```

### NATS DLQ check

```bash
# Check the durable on the tenant's ingress stream
nats consumer info INGRESS-<TENANT> skb-ingestion-worker

# View recent SKB ingestion messages on a tenant's ingress stream
nats stream view INGRESS-<TENANT> --last

# Inspect the per-tenant dead-letter queue for permanent failures
nats stream view DLQ-<TENANT> --last
```

---

## 4. Manually Triggering Re-ingestion

### Via API

Through the api-gateway (note the `/api` global prefix, and no `file_id` — the
server generates it; sending an unknown field is a **400** because the shared
ValidationPipe runs `forbidNonWhitelisted: true`):

```bash
curl -X POST "https://<host>/api/admin/structured-kb/containers/<container-id>/files" \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-yoizen-tenant: <tenant>" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "data.csv",
    "file_base64": "'"$(base64 < data.csv | tr -d '\n')"'",
    "categories": ["sales", "q1"]
  }'
# 202 {"fileId":"<uuid>","status":"pending"}
```

### Reset stuck file status (then re-ingest)

```sql
-- Reset file to pending so it can be re-ingested
UPDATE skb_files
SET status = 'pending', error_message = NULL, updated_at = NOW()
WHERE id = '<file-id>';

-- Then trigger re-ingestion via the API
```

### Full container re-ingest

There is no list-files route, so enumerate from the DB and re-upload each source
file. Each upload gets a NEW server-generated `fileId`, so re-uploading does not
replace the previous rows — delete them first if you want a clean re-ingest.

```sql
SELECT id, file_id, original_name, status
FROM skb_files
WHERE container_id = '<container-id>' AND is_active = true;
```

```bash
curl -X POST "https://<host>/api/admin/structured-kb/containers/<container-id>/files" \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-yoizen-tenant: <tenant>" \
  -H "Content-Type: application/json" \
  -d '{ "filename": "data.csv", "file_base64": "..." }'
```

---

## 5. Debugging Query Failures

### Check query history

Query history IS recorded. `SKBQueryService.recordQueryHistory()` fires on both
the success and the error path and is intentionally not awaited — a failed insert
is logged at `warn` and never fails the query.

Column names come from `SKBQueryHistoryRepository.recordQuery`'s INSERT and the
`skb_query_history` DDL — `nl_query` / `generated_sql` / `created_at`, **not**
`natural_query` / `sql_where` / `sql_sort` / `executed_at`:

```sql
SELECT id, nl_query, generated_sql, result_count, duration_ms, error, created_at
FROM skb_query_history
WHERE container_id = '<container-id>'
ORDER BY created_at DESC
LIMIT 20;
```

`correlation_id`, `causation_id` and `execution_id` exist but are NULL for every
row today: the only caller is `StructuredKBController.query`, which has no
execution context to thread.

### Common failure patterns

| Error Message | Cause | Fix |
|---------------|-------|-----|
| "SQL safety violation" | LLM generated blocked pattern | Rephrase query or check schema |
| "LLM translation failed" | AI provider error | Check provider status / API key |
| Empty results | WHERE too restrictive | Check schema columns and types |
| Timeout | Complex query on large dataset | Add functional indexes |

### Inspect schema for a container

```sql
SELECT file_id, table_description, query_rules, columns
FROM skb_schemas
WHERE container_id = '<container-id>';
```

### Verify functional indexes exist

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'skb_rows'
  AND indexname LIKE 'idx_skb_dyn_%';
```

---

## 6. Monitoring via Grafana

### Key Metrics

> **None of the `skb_*` metrics below are emitted.** `rg 'skb_ingestion_duration_seconds|skb_query_duration_seconds|skb_query_safety_violations_total|skb_rows_total|skb_ingestion_files_stuck' services packages` returns nothing — SKB ships no instrumentation of its own. Today the only real signals are the generic NATS-consumer metrics (`nats.consumer.*`, `DOCS/architecture/observability.md` §3) plus the SQL queries below. The table is a wish list, not a dashboard.

| Proposed metric (NOT emitted) | Intended source | Intended threshold |
|--------|--------|-----------------|
| `skb_ingestion_duration_seconds` | Worker | > 300s (5 min) |
| `skb_ingestion_files_stuck` | Watchdog | > 0 |
| `skb_query_duration_seconds` | API | > 10s |
| `skb_query_safety_violations_total` | API | > 0 |
| `skb_rows_total` (per container) | DB | > 500,000 |

### Grafana Dashboard Panels (proposed — no SKB dashboard is shipped)

1. **Ingestion throughput** — Files processed per hour
2. **Ingestion latency** — P50/P95/P99 file processing time
3. **Query latency** — P50/P95/P99 query execution time
4. **Row count per container** — Bar chart
5. **Safety violations** — Counter with alert
6. **Worker health** — Pod restarts, memory usage
7. **NATS consumer lag** — Pending messages per consumer

### Queries for ad-hoc monitoring

```sql
-- Ingestion pipeline performance
SELECT
  c.name AS container,
  f.original_name AS file,
  f.status,
  f.row_count,
  f.updated_at - f.created_at AS processing_duration
FROM skb_files f
JOIN skb_containers c ON c.id = f.container_id
WHERE f.updated_at > NOW() - INTERVAL '24 hours'
ORDER BY f.updated_at DESC;

-- Container row counts
SELECT c.name, COUNT(r.id) AS row_count
FROM skb_containers c
LEFT JOIN skb_rows r ON r.container_id = c.id
WHERE c.is_active = true
GROUP BY c.id, c.name
ORDER BY row_count DESC;
```

---

## 7. Common Issues and Fixes

### File stuck in `processing`

**Symptoms:** File status stays `processing` for > 10 minutes. Container
status stays `processing`.

**Cause:** Worker crash, NATS disconnect, or OOM during large file ingestion.

**Fix:**
1. Check worker logs: `kubectl logs <pod> -n <ns> | grep <file-id>`
2. The watchdog normally resets this for you (to `failed`, then recomputes the
   container status). It only sweeps tenants whose connection pool this pod has
   already opened — if it did not pick the file up, reset manually:
   ```sql
   UPDATE skb_files SET status = 'failed',
     error_message = 'Manual reset by ops',
     updated_at = NOW()
   WHERE id = '<file-id>';
   ```
3. Re-trigger ingestion via API

### OOM on large file (>100k rows)

**Symptoms:** Worker pod restarts, file stays in `processing`.

**Fix:**
1. Increase worker memory limit: `--max-old-space-size=4096`
2. Check if file exceeds 500k row limit
3. Consider splitting the file

### Query returns empty results

**Symptoms:** User query returns 0 results for a container with data.

**Diagnosis:**
1. Read the generated SQL from `skb_query_history.generated_sql` (see Section 5), or from the service logs
2. Verify the schema has the expected columns: `SELECT columns FROM skb_schemas WHERE container_id = '...'`
3. Run the generated SQL directly against the DB to verify
4. Check if column names match (normalization issues)

### LLM translation failure

**Symptoms:** "LLM translation failed" error on query.

**Fix:**
1. Check AI provider status (OpenAI, Anthropic, etc.)
2. Verify the OpenAI credentials available to the service (the container's `provider_config` is NOT used at runtime — the query service hardcodes openai/`gpt-4o`)
3. Check rate limiting on the AI provider
4. Retry the query

### Slow queries on large containers

**Symptoms:** Queries take > 5 seconds.

**Fix:**
1. Check if functional indexes exist for the queried columns
2. Create missing indexes:
   ```sql
   CREATE INDEX CONCURRENTLY idx_skb_dyn_<col>
     ON skb_rows ((data->>'<col>')::numeric)
     WHERE container_id = '<container-id>';
   ```
3. Use `SKBRowIndexService.ensureIndexes()` programmatically
4. Check row count: `SELECT COUNT(*) FROM skb_rows WHERE container_id = '...'`

### Schema analysis failure

**Symptoms:** File parses but schema analysis fails.

**Diagnosis:**
1. Check file encoding (should be UTF-8 or detectable)
2. Verify column count < 100
3. Check LLM provider connectivity
4. Look at file content for unusual characters

---

## 8. Support Contacts

| Role | Contact | Escalation |
|------|---------|------------|
| Platform on-call | See PagerDuty schedule | P1 incidents |
| SKB module owner | See service catalog | Bug fixes, feature requests |
| Database team | See #dba Slack channel | Schema issues, index performance |
| AI/LLM provider | See provider status page | API outages, rate limits |

### Useful Links

- Architecture doc: `DOCS/skb/architecture.md`
- Security review: `DOCS/skb/security.md`
- Service repository: `services/agent-admin-service/`
- Test suite: `services/agent-admin-service/test/unit/structured-kb/`
