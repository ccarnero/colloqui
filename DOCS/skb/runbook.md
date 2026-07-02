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

> **Known limitations in the current tree**: the file upload route is not
> implemented in `agent-admin-service`, the worker's file-status updates target
> a `skb_container_files` table that is never created, its `insertRows` call
> does not match the repository signature, the watchdog stuck-file lookup is
> stubbed, and query history is never recorded. See
> `DOCS/skb/architecture.md` §8.1 "Known wiring defects" for details.

**Key tables:**
- `skb_containers` — Container metadata and status
- `skb_files` — Per-file status tracking
- `skb_schemas` — LLM-analyzed column schemas
- `skb_rows` — Actual data (JSONB)
- `skb_query_history` — Query audit log

---

## 2. Restarting the Ingestion Worker

### Kubernetes

```bash
# Find worker pods
kubectl get pods -l app=agent-admin-service -n <tenant-ns>

# Restart by deleting the pod (deployment will recreate it)
kubectl delete pod <worker-pod-name> -n <tenant-ns>

# Or scale down/up
kubectl scale deployment agent-admin-service --replicas=0 -n <tenant-ns>
kubectl scale deployment agent-admin-service --replicas=1 -n <tenant-ns>
```

### Verify startup

```bash
# Check logs for successful init
kubectl logs <worker-pod-name> -n <tenant-ns> | grep "SKB ingestion worker started"

# Expected output:
# SKB ingestion worker started, consuming 'evt.*.agent-admin-service....skb_file_ingestion.v1'
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

The `SKBIngestionWatchdogService` is meant to detect files stuck in
`processing` (threshold: 10 minutes), but its stuck-file lookup
(`SKBContainersRepository.findProcessingFilesOlderThan`) is currently stubbed
to return an empty list — automatic detection/reset does NOT happen. Use the
manual checks below.

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

```bash
# Re-ingest a specific file
curl -X POST "https://<host>/admin/structured-kb/containers/<container-id>/files" \
  -H "x-yoizen-tenant: <tenant>" \
  -H "Content-Type: application/json" \
  -d '{
    "file_id": "<file-id>",
    "filename": "data.csv",
    "file_base64": "<base64-encoded-file>",
    "categories": ["sales", "q1"]
  }'
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

```bash
# 1. Get all files for the container (list-files route is pending implementation)
# 2. For each file, re-upload via the files endpoint
# (The ingestion pipeline deletes previous rows for the same file_id before inserting)
curl -X POST "https://<host>/admin/structured-kb/containers/<container-id>/files" \
  -H "x-yoizen-tenant: <tenant>" \
  -H "Content-Type: application/json" \
  -d '{ "file_id": "...", "filename": "data.csv", "file_base64": "..." }'
```

---

## 5. Debugging Query Failures

### Check query history

> **Not currently usable**: query history recording is not wired —
> `SKBQueryHistoryService.recordQuery()` has no call sites, so
> `skb_query_history` is always empty (and the repository's insert targets
> columns that don't exist in the DDL). Use service logs to inspect generated
> SQL instead.

```sql
-- Recent queries with results (will return no rows until recording is wired)
SELECT id, natural_query, sql_where, sql_sort, result_count, executed_at
FROM skb_query_history
WHERE container_id = '<container-id>'
ORDER BY executed_at DESC
LIMIT 20;
```

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

| Metric | Source | Alert Threshold |
|--------|--------|-----------------|
| `skb_ingestion_duration_seconds` | Worker | > 300s (5 min) |
| `skb_ingestion_files_stuck` | Watchdog | > 0 |
| `skb_query_duration_seconds` | API | > 10s |
| `skb_query_safety_violations_total` | API | > 0 |
| `skb_rows_total` (per container) | DB | > 500,000 |
| `nats_dlq_messages` | NATS | > 0 |

### Grafana Dashboard Panels

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
2. The watchdog does NOT auto-reset today (stuck-file lookup is stubbed), so reset manually:
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
1. Check service logs for the generated SQL (`skb_query_history` is never populated — see Section 5)
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
