# SKB — design decisions and design-time risk analysis

Class: RECORD
Summary: The two design-time sections carved out of `DOCS/skb/architecture.md` — the ADR-001 row-storage decision and the risk/mitigation analysis written while SKB was being ported from Yoizen.yIA.Ingest.

> **RECORD — dated, not present truth.** Carved out of `DOCS/skb/architecture.md`
> by the docs-truth-audit T10 (ruling D8): that file carried two classes at once.
> Everything here is the ORIGINAL design reasoning from the 2026 port of
> Yoizen.yIA.Ingest's SKB pipeline. It is kept because the decision and the
> options rejected alongside it are worth having, not because it describes the
> code as it stands. For as-built SKB behaviour read
> [`architecture.md`](./architecture.md), [`api.md`](./api.md) and
> [`runbook.md`](./runbook.md).
>
> **Known divergence, verified 2026-08-04:** §9.1 presents `validateSQLSafety()`
> as a shipped layer of defence. The real helpers `validateSelectOnly()` and
> `enforceLimit()` in `skb-sql-safety.ts` are exported and unit-tested but
> **never called** on the query path (audit escalation E8), and the query path
> additionally interpolates `containerId`/`categories` into `sql.unsafe()`
> (escalation E9, a genuine injection, tracked in its own security loop). The
> live security picture is [`security.md`](./security.md), not this file.

---

## 7. Storage Strategy (ADR-001)

### Decision: JSONB column with GIN index + generated TSVECTOR

**Context**: SKB rows have dynamic columns (different per file). We need to store them efficiently and support both structured filtering and full-text search.

**Options considered**:

| Approach | Pros | Cons |
|----------|------|------|
| **A: JSONB + GIN + TSVECTOR** | Single table, simple schema, GIN indexing, `@>` operator for nested lookups, FTS via generated column | Slower numeric range queries (`(data->>'price')::numeric > 100`) |
| **B: Generated columns + partial indexes** | Fast typed queries (native PostgreSQL types) | DDL explosion per container, schema migration per file, complex index management |
| **C: EAV (entity-attribute-value)** | Maximum flexibility | Terrible query performance, n+1 joins, no FTS, unreadable SQL |
| **D: Separate table per container** | Best query performance, typed columns | DDL per container, migration nightmare, schema evolution pain |

**Decision**: **Option A — JSONB with GIN + generated TSVECTOR**.

**Rationale**:
1. The Python reference stores everything in a single MongoDB collection with dynamic fields. JSONB is the PostgreSQL equivalent.
2. GIN index supports `@>` (containment), `?` (key exists), `@?` (JSONPath) — covering 90% of query patterns.
3. The generated TSVECTOR column provides full-text search without additional write complexity.
4. Numeric range queries are acceptable with the expected dataset sizes (< 500k rows per container). For the rare slow case, a functional index `(data->>'price')::numeric` can be added.
5. Schema evolution is trivial — just different JSONB shapes. No DDL changes needed.

**Consequences**:
- All column values stored as JSONB — type casting happens at query time via `(data->>'col')::type`.
- For performance-critical numeric range queries on large datasets, add targeted functional indexes:

```sql
-- Example: add functional index for a numeric column
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_skb_rows_price
  ON skb_rows (((data->>'price')::numeric))
  WHERE container_id = 'specific-container-id';
```

These can be created dynamically after schema analysis detects a numeric column with `is_filterable = true`.

---

---

## 9. Risks & Mitigations

### 9.1 SQL Injection in NL→SQL Translation

| Risk | Severity | Mitigation |
|------|----------|------------|
| LLM generates destructive SQL (DROP, DELETE, etc.) | Critical | Multi-layer defense: (1) Prompt explicitly forbids DML/DDL, (2) `validateSQLSafety()` regex blocklist, (3) Query only touches `skb_rows` via fixed SELECT template, (4) DB user has SELECT-only grants on `skb_rows` (future), (5) `LIMIT` enforced at max 100 |
| LLM generates `UNION` to read other tables | High | `UNION` pattern blocked by `validateSQLSafety()`, plus the fixed query template never includes table name in user-controlled portion |
| LLM generates `pg_catalog` or `information_schema` access | High | Pattern blocked by `validateSQLSafety()` |

### 9.2 Large File Handling (500k+ rows)

| Risk | Mitigation |
|------|------------|
| Memory pressure parsing 500k rows | Worker runs with `--max-old-space-size=4096`; parse rows in streaming mode for CSV via `papaparse` `step` callback |
| Insert takes > 15 min timeout | Batch INSERT (5000 rows/batch), extendable ack timeout per batch |
| Blocking the event loop | File parsing in worker thread via `worker_threads` (same pattern as Python's `asyncio.to_thread`) |
| Row count exceeds PostgreSQL limits | Hard limit 500k rows per file (same as Python reference) |

### 9.3 Schema Evolution Across File Versions

| Risk | Mitigation |
|------|------------|
| New file version adds/removes columns | Schema is per-file, not per-container. Each file has its own `skb_schemas` row. Query service merges schemas at query time. |
| Column type changes between versions | Each file's rows are stored with its own schema. Query prompt includes ALL columns from ALL schemas in the container. Missing columns return NULL. |
| Conflicting column names across files | Normalized headers ensure consistency. If file A has "Price" and file B has "price", both normalize to "price". |

### 9.4 Multi-Tenant Isolation

| Risk | Mitigation |
|------|------------|
| Cross-tenant data leakage | Every query includes `tenant_id` filter. NATS consumer is per-tenant stream. Connection pools are per-tenant. |
| Schema pollution | `skb_containers.tenant_id` + `skb_rows.tenant_id` checked in every query. Index on `(container_id, tenant_id)` ensures performance. |
| Worker processes wrong tenant | NATS message envelope includes `tenantId` — worker verifies against `x-yoizen-tenant` context. |

---
