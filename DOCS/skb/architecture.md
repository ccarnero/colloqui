# SKB — Structured Knowledge Base Architecture

*SKB is a module inside `agent-admin-service` (`src/modules/structured-kb/`, `SERVICE_MODE=api|worker`) — there is no standalone SKB service.*

> ADR-style design for porting Yoizen.yIA.Ingest's SKB pipeline to the
> TypeScript / NestJS / PostgreSQL / pgvector stack.

---

## Table of Contents

1. [Glossary & Scope](#1-glossary--scope)
2. [Data Model](#2-data-model)
3. [API Surface](#3-api-surface)
4. [Ingestion Pipeline](#4-ingestion-pipeline)
5. [LLM Schema Analysis](#5-llm-schema-analysis)
6. [Query Pipeline](#6-query-pipeline)
7. [Storage Strategy (ADR-001)](#7-storage-strategy-adr-001)
8. [File Change Plan](#8-file-change-plan)
9. [Risks & Mitigations](#9-risks--mitigations)
10. [Phased Implementation Plan](#10-phased-implementation-plan)

---

## 1. Glossary & Scope

| Term | Meaning |
|------|---------|
| **SKB Container** | Top-level entity grouping files. Mirrors `KB` (knowledge-base) — has id, version, status. |
| **SKB File** | A single CSV/Excel file inside a container. Parsed, analyzed, and stored as typed rows. |
| **Schema** | Per-file LLM-generated column metadata (types, descriptions, query hints). |
| **Row** | A single data record, stored as typed JSONB with generated index columns. |
| **KB** | Existing knowledge-base (unstructured: PDF, docx → chunks → embeddings). |
| **SKB** | New structured knowledge-base (CSV/Excel → typed rows → NL→SQL query). |

### Scope

- **In scope**: Container CRUD, file ingestion pipeline (CSV/Excel), LLM schema analysis, NL→SQL query, multi-tenant isolation, Admin Console read-only views.
- **Out of scope**: File download from external URL (assumes admin-console uploads base64), embedding vectors (SKB rows are NOT embedded), RAG hybrid queries (future).

---

## 2. Data Model

### 2.1 PostgreSQL Tables

All tables live in the per-tenant PostgreSQL schema, applied via `schema-initializer.ts`.

#### `skb_containers`

```sql
CREATE TABLE IF NOT EXISTS skb_containers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       VARCHAR(255) NOT NULL,
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','ready','failed')),
  version         VARCHAR(64) NOT NULL DEFAULT 'v1',
  ingest_model    VARCHAR(128) DEFAULT 'gpt-4.1-mini',
  query_model     VARCHAR(128) DEFAULT 'gpt-4.1-mini',
  provider_config JSONB DEFAULT '{}'::jsonb,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, id, version)
);

CREATE INDEX IF NOT EXISTS idx_skb_containers_tenant
  ON skb_containers(tenant_id, is_active);
```

#### `skb_files`

```sql
CREATE TABLE IF NOT EXISTS skb_files (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id    UUID NOT NULL REFERENCES skb_containers(id) ON DELETE CASCADE,
  tenant_id       VARCHAR(255) NOT NULL,
  file_id         VARCHAR(255) NOT NULL,
  original_name   VARCHAR(512) NOT NULL,
  detected_encoding VARCHAR(32),
  categories      JSONB DEFAULT '[]'::jsonb,
  row_count       INTEGER DEFAULT 0,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','completed','failed')),
  error_message   TEXT,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (container_id, file_id)
);

CREATE INDEX IF NOT EXISTS idx_skb_files_container
  ON skb_files(container_id, is_active);
CREATE INDEX IF NOT EXISTS idx_skb_files_categories
  ON skb_files USING gin (categories);
```

#### `skb_schemas`

Stores per-file LLM-analyzed schema as JSONB.

```sql
CREATE TABLE IF NOT EXISTS skb_schemas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id    UUID NOT NULL REFERENCES skb_containers(id) ON DELETE CASCADE,
  file_id         UUID NOT NULL REFERENCES skb_files(id) ON DELETE CASCADE,
  tenant_id       VARCHAR(255) NOT NULL,
  table_description TEXT,
  query_rules     TEXT,
  columns         JSONB NOT NULL DEFAULT '[]'::jsonb,
  row_count       INTEGER DEFAULT 0,
  analyzed_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (file_id)
);

CREATE INDEX IF NOT EXISTS idx_skb_schemas_container
  ON skb_schemas(container_id);
```

`columns` JSONB structure (array of objects):

```typescript
interface SKBColumnSchema {
  name: string;            // normalized column name (lowercase, underscore)
  original_name: string;   // raw header from file
  type: 'text' | 'categorical' | 'numeric' | 'date' | 'boolean' | 'unknown';
  description: string;
  sample_values: string[];
  is_filterable: boolean;
  query_hints: string[];
}
```

#### `skb_rows`

The main data table — JSONB payload with generated typed columns for filtering.

```sql
CREATE TABLE IF NOT EXISTS skb_rows (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id    UUID NOT NULL REFERENCES skb_containers(id) ON DELETE CASCADE,
  file_id         UUID NOT NULL REFERENCES skb_files(id) ON DELETE CASCADE,
  tenant_id       VARCHAR(255) NOT NULL,
  categories      JSONB DEFAULT '[]'::jsonb,
  data            JSONB NOT NULL DEFAULT '{}'::jsonb,
  data_tsv        TSVECTOR GENERATED ALWAYS AS (
                    to_tsvector('simple', coalesce(data::text, ''))
                  ) STORED,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_skb_rows_container
  ON skb_rows(container_id);
CREATE INDEX IF NOT EXISTS idx_skb_rows_file
  ON skb_rows(file_id);
CREATE INDEX IF NOT EXISTS idx_skb_rows_categories
  ON skb_rows USING gin (categories);
CREATE INDEX IF NOT EXISTS idx_skb_rows_tsv
  ON skb_rows USING gin (data_tsv);
```

#### `skb_query_history`

```sql
CREATE TABLE IF NOT EXISTS skb_query_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id    UUID NOT NULL REFERENCES skb_containers(id),
  tenant_id       VARCHAR(255) NOT NULL,
  natural_query   TEXT NOT NULL,
  sql_where       TEXT,
  sql_sort        TEXT,
  result_count    INTEGER DEFAULT 0,
  executed_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_skb_query_history_container
  ON skb_query_history(container_id, executed_at DESC);
```

### 2.2 TypeScript Interfaces

```typescript
// src/modules/structured-kb/types/skb.types.ts

export type SKBColumnType =
  | 'text'
  | 'categorical'
  | 'numeric'
  | 'date'
  | 'boolean'
  | 'unknown';

export interface SKBColumnSchema {
  name: string;
  original_name: string;
  type: SKBColumnType;
  description: string;
  sample_values: string[];
  is_filterable: boolean;
  query_hints: string[];
}

export interface SKBSchema {
  table_description: string;
  columns: SKBColumnSchema[];
  query_rules: string;
  row_count: number;
  analyzed_at: string;
}

export type SKBContainerStatus = 'pending' | 'processing' | 'ready' | 'failed';
export type SKBFileStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ParsedTable {
  headers: string[];
  originalHeaders: string[];
  rows: Record<string, string>[];
  rowCount: number;
  detectedEncoding: string;
}

export interface SKBContainerRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  status: SKBContainerStatus;
  version: string;
  ingest_model: string;
  query_model: string;
  provider_config: Record<string, unknown>;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface SKBFileRow {
  id: string;
  container_id: string;
  tenant_id: string;
  file_id: string;
  original_name: string;
  detected_encoding: string | null;
  categories: string[];
  row_count: number;
  status: SKBFileStatus;
  error_message: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}
```

---

## 3. API Surface

All endpoints live under `admin/structured-kb` to clearly distinguish from
the existing `admin/knowledge-bases`.

### 3.1 Container Endpoints

Handled by `SKBContainersController` (`@Controller("admin/structured-kb/containers")`).

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/admin/structured-kb/containers` | Create empty container |
| `GET` | `/admin/structured-kb/containers` | List containers |
| `GET` | `/admin/structured-kb/containers/:id` | Get container detail |
| `PATCH` | `/admin/structured-kb/containers/:id` | Update container config |
| `DELETE` | `/admin/structured-kb/containers/:id` | Soft-delete container (returns 204 No Content) |

### 3.2 File Endpoints

File ingest is routed through the api-gateway (`AdminStructuredKBController`) which proxies to `agent-admin-service`. There is no dedicated files controller in `agent-admin-service` — file metadata is managed by `SKBContainersService` and the ingestion worker.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/admin/structured-kb/containers/:id/files` | Upload + queue CSV/Excel for ingestion |

> **Note**: List files, delete file, and get file schema endpoints are proxied via api-gateway but the corresponding handler routes in `agent-admin-service` are not yet implemented in the controllers layer. File status is queryable via `skb_files` directly.

### 3.3 Query Endpoint

Handled by `StructuredKBController` (`@Controller("admin/structured-kb")`).

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/admin/structured-kb/containers/:id/query` | Natural language → SQL query |

### 3.4 DTOs

```typescript
// Create container — actual DTO (version/ingest_model/query_model/provider_config
// are set at DB default level; not exposed in the create DTO)
export class CreateSKBDto {
  @IsString() @IsNotEmpty()
  name!: string;

  @IsString() @IsOptional()
  description?: string;
}

// Ingest file
export class IngestSKBFileDto {
  @IsString() @IsNotEmpty()
  file_id!: string;

  @IsString() @IsNotEmpty()
  filename!: string;

  @IsString() @IsNotEmpty()
  file_base64!: string;

  @IsArray() @IsOptional()
  categories?: string[];

  @IsString() @IsOptional()
  sheet_name?: string;
}

// Query
export class QuerySKBDto {
  @IsString() @IsNotEmpty()
  query!: string;

  @IsArray() @IsOptional()
  categories?: string[];

  @IsNumber() @IsOptional()
  limit?: number;

  @IsNumber() @IsOptional()
  offset?: number;
}

// Responses — as returned by SKBQueryService
export interface QueryResult {
  results: Record<string, unknown>[];
  sql: string;          // debug: full SQL that was executed
  totalCount: number;   // total matching rows (before limit)
}
```

### 3.5 How SKB Differs from KB

| Aspect | KB (existing) | SKB (new) |
|--------|---------------|-----------|
| Input | PDF, docx, text, markdown, HTML | CSV, Excel (.xlsx/.xls) |
| Processing | Text extraction → chunking → embedding | Parse rows → LLM schema analysis → typed storage |
| Storage | `document_chunks` + `document_chunks_embedding` (pgvector) | `skb_rows` (JSONB + GIN + TSVECTOR) |
| Query | Vector similarity search via pgvector | NL→SQL WHERE/ORDER BY via LLM |
| Schema | Fixed (content, embedding) | Dynamic per-file (LLM-detected column types) |
| Search | Semantic (cosine distance) | Structured (SQL filters) + full-text |

---

## 4. Ingestion Pipeline

### 4.1 Flow

```
Admin Console / api-gateway
    │ POST /admin/structured-kb/containers/:id/files
    │ (file_base64 + filename)
    ▼
AdminStructuredKBController (api-gateway) → proxy to agent-admin-service
    │ 1. Decode base64 → Buffer
    │ 2. Create skb_files row (status=pending)
    │ 3. Publish NATS event: skb_file_ingestion.v1
    │ 4. Return { fileId, status: "pending" }
    ▼
NATS JetStream (per-tenant INGRESS-<tenant> streams)
    │ evt.{tenant}.agent-admin-service.automation.platform.internal.skb_file_ingestion.v1
    ▼
SKBIngestionWorkerService (SERVICE_MODE=worker)
    │ 1. Mark file status=processing
    │ 2. Recompute container status
    │ 3. Parse file (CSV/Excel) → ParsedTable
    │ 4. LLM schema analysis → SKBSchema
    │ 5. Save schema to skb_schemas
    │ 6. Cast rows by schema types
    │ 7. Delete previous rows for same file_id
    │ 8. Insert rows in batches of 5000
    │ 9. Mark file status=completed
    │ 10. Recompute container status=ready
    ▼
On failure:
    │ - Delete partial rows
    │ - Delete partial schema
    │ - Mark file status=failed
    │ - Recompute container status
```

### 4.2 NATS Event Subject

```
evt.{tenant}.agent-admin-service.automation.platform.internal.skb_file_ingestion.v1
```

Payload (as consumed by `SKBIngestionWorkerService.handleMessage` — fields ride in `data.payload` of the canonical envelope; a bare payload object is also tolerated):

```typescript
{
  containerId: string;  // SKB container DB UUID (required)
  fileId: string;       // logical file ID (required)
  tenantId: string;     // tenant slug (required)
  kbId?: string;        // job-tracking KB id; defaults to containerId
  fileUrl?: string;     // URL the worker passes to SKBFileParser to fetch content
}
```

Missing `containerId`/`fileId`/`tenantId` → `PermanentError` → term + per-tenant DLQ. Note: file content is fetched via `fileUrl` — it is NOT carried inline as base64 in the event. The event publisher is not present in the current tree (only the worker-side consumer exists); treat the publish step in the flow diagram above as the intended contract, verified on the consumer side only.

### 4.3 Death Checks + Cleanup

Following the Python reference pattern (`_skb_version_exists`, `_skb_job_is_active`):

1. **Container deleted check**: Before each pipeline stage, verify `skb_containers` row still exists and `is_active = true`.
2. **Timeout**: Worker ack timeout 15 minutes (matching Python's `SKB_INGEST_FILE_TIMEOUT_SECONDS`).
3. **Partial cleanup on failure**: `DELETE FROM skb_rows WHERE file_id = $1`, `DELETE FROM skb_schemas WHERE file_id = $1`.
4. **Watchdog**: Extend existing `IngestionWatchdogService` to also reset stuck SKB files.

### 4.4 Worker Pattern

`SKBIngestionWorkerService` delegates to `MultiTenantConsumerManager` (package
`@yoizen/database`), which creates **one durable consumer per tenant INGRESS stream** rather
than a single shared stream.

**Why this changed**: an earlier design used a single `SKB-INGESTION` stream with subjects
`evt.*.agent-admin-service…skb_file_ingestion.v1`. Those subjects overlapped the per-tenant
`evt.<tenant>.>` subjects already captured by `INGRESS-<tenant>` streams, which caused
JetStream to reject stream creation with _"subjects overlap with an existing stream"_ and
broke tenant provisioning entirely.

The new design attaches to the per-tenant `INGRESS-<tenant>` streams that already exist —
no extra stream is created — and applies a filter subject to consume only SKB events from
each one.

| Parameter | Value |
|-----------|-------|
| Stream pattern | `/^INGRESS-/` (auto-discovered; reconciled periodically) |
| Durable name | `skb-ingestion-worker` (same name on every tenant stream) |
| Filter subject | `evt.*.agent-admin-service.automation.platform.internal.skb_file_ingestion.v1` |
| Max deliveries | 5 |
| Ack wait | 5 min (300 000 ms) — files can be large |
| Backoff | 60 s → 120 s → 300 s → 600 s |
| Permanent failure | `msg.term()` + publish to `DLQ-<tenant>` stream |
| Transient failure | `msg.nak()` with the backoff schedule above |

The manager auto-discovers existing `INGRESS-*` streams at startup and reconciles on an
interval to pick up newly provisioned tenants without a worker restart. Worker only
starts when `SERVICE_MODE=worker`.

---

## 5. LLM Schema Analysis

### 5.1 Adaptation: `litellm.acompletion` → AI SDK `generateObject`

Python uses `litellm.acompletion` with `response_format={"type": "json_object"}` and manual JSON parse + retry.
We replace this with the Vercel AI SDK's `generateObject` which provides:

- Built-in Zod schema validation
- Automatic retry on parse failure
- Provider-agnostic interface (already have `ai` + `@ai-sdk/openai` in dependencies)

```typescript
import { generateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';

const SKBColumnSchemaZod = z.object({
  name: z.string(),
  original_name: z.string(),
  type: z.enum(['text', 'categorical', 'numeric', 'date', 'boolean', 'unknown']),
  description: z.string(),
  sample_values: z.array(z.string()),
  is_filterable: z.boolean(),
  query_hints: z.array(z.string()),
});

const SKBSchemaAnalysisZod = z.object({
  table_description: z.string(),
  query_rules: z.string(),
  columns: z.array(SKBColumnSchemaZod),
});
```

### 5.2 Provider Resolution

```typescript
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
// etc.

function createModel(config: ProviderConfig) {
  switch (config.provider) {
    case 'openai':
      return createOpenAI({ apiKey: config.apiKey, baseURL: config.apiBaseUrl })(config.model);
    case 'anthropic':
      return createAnthropic({ apiKey: config.apiKey })(config.model);
    default:
      return createOpenAI({ apiKey: config.apiKey, baseURL: config.apiBaseUrl })(config.model);
  }
}
```

### 5.3 Prompt Construction

```typescript
function buildSchemaAnalysisPrompt(parsed: ParsedTable): string {
  const columnSamples = parsed.headers.map(h => {
    const samples = parsed.rows
      .map(r => r[h])
      .filter(v => v && v.trim())
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 5);
    return `  - ${h}: ${samples.length ? samples.map(s => `"${s}"`).join(', ') : '(no values)'}`;
  }).join('\n');

  const sampleRows = getSampleRows(parsed.rows, 20);

  return `
Dataset Overview:
- Total rows: ${parsed.rowCount}
- Columns (${parsed.headers.length} total):
${columnSamples}

Sample rows (up to 20, representative of the dataset):
${JSON.stringify(sampleRows, null, 2)}

Heuristic hints for type detection:
- Values "true"/"false"/"yes"/"no"/"verdadero"/"falso"/"si" (case-insensitive) → boolean
- Values parseable as dates (e.g. "2024-01-01", "01/01/2024", "31/12/2024") → date
- All values parseable as numbers → numeric
- Low cardinality (fewer than 20% unique values relative to total rows) → categorical
- Otherwise → text
`;
}
```

### 5.4 Column Name Normalization

Port `_normalize_column_name` from Python:

```typescript
function normalizeColumnName(name: string, index: number): string {
  let n = name.trim();
  if (!n) return `column_${index}`;
  n = n.replace(/[^a-zA-Z0-9_]/g, '_');
  n = n.replace(/_+/g, '_').replace(/^_|_$/g, '');
  n = n.toLowerCase();
  if (!n) return `column_${index}`;
  return n;
}

function normalizeHeaders(original: string[]): string[] {
  const normalized: string[] = [];
  const seen = new Map<string, number>();

  for (let i = 0; i < original.length; i++) {
    let base = normalizeColumnName(original[i], i + 1);
    if (!seen.has(base)) {
      seen.set(base, 1);
      normalized.push(base);
    } else {
      const count = seen.get(base)! + 1;
      seen.set(base, count);
      normalized.push(`${base}_${count}`);
    }
  }
  return normalized;
}
```

---

## 6. Query Pipeline

### 6.1 NL → SQL Translation

The Python reference uses `SKBRetriever` which translates NL → MongoDB filter via LLM.
We adapt to NL → SQL WHERE/ORDER BY clauses.

```typescript
import { generateObject } from 'ai';
import { z } from 'zod';

const SQLTranslationZod = z.object({
  where_clause: z.string().describe(
    'SQL WHERE clause (without "WHERE" keyword). Use parameterized column names from the schema.'
  ),
  order_by: z.string().optional().describe(
    'SQL ORDER BY clause (without "ORDER BY" keyword). E.g. "price DESC NULLS LAST"'
  ),
  explanation: z.string().describe('Brief explanation of the translation'),
});
```

### 6.2 Query Prompt

```typescript
function buildQueryPrompt(
  nlQuery: string,
  schema: SKBSchema,
  categories: string[],
): string {
  const columnsInfo = schema.columns.map(c =>
    `- ${c.name} (${c.type}): ${c.description}. Filterable: ${c.is_filterable}. Hints: ${c.query_hints.join(', ')}`
  ).join('\n');

  return `
You are a SQL query translator. Translate the following natural language query
into a safe SQL WHERE clause for a PostgreSQL table.

Table description: ${schema.table_description}
Query rules: ${schema.query_rules}

Available columns:
${columnsInfo}

${categories.length ? `Category filter (AND with WHERE): categories field must include ALL of: ${categories.map(c => `"${c}"`).join(', ')}` : ''}

IMPORTANT RULES:
1. ONLY generate WHERE conditions and ORDER BY. Never generate SELECT, FROM, INSERT, UPDATE, DELETE, DROP, etc.
2. Use ONLY column names listed above.
3. For text columns use ILIKE for case-insensitive matching.
4. For categorical columns use exact match with IN or =.
5. For numeric columns use standard comparison operators.
6. For date columns use PostgreSQL date functions.
7. For boolean columns use IS TRUE / IS FALSE.
8. Access column values via (data->>'column_name') for text comparisons
   or (data->>'column_name')::numeric for numeric comparisons.
9. Use parentheses to group OR conditions properly.
10. NEVER include semicolons.

Natural language query: "${nlQuery}"

${schema.query_rules ? `Additional query rules from schema: ${schema.query_rules}` : ''}
`;
}
```

### 6.3 Query Execution

```typescript
async function executeSKBQuery(
  sql: Sql,
  containerId: string,
  tenantId: string,
  translation: { where_clause: string; order_by?: string },
  categories: string[],
  limit: number,
  offset: number,
): Promise<SKBQueryResult> {
  // Validate WHERE clause safety
  validateSQLSafety(translation.where_clause);

  const whereParts: string[] = [
    `container_id = '${containerId}'`,
    `tenant_id = '${tenantId}'`,
  ];

  if (translation.where_clause.trim()) {
    whereParts.push(`(${translation.where_clause})`);
  }

  if (categories.length > 0) {
    whereParts.push(`categories @> '${JSON.stringify(categories)}'::jsonb`);
  }

  const where = whereParts.join(' AND ');
  const orderBy = translation.order_by?.trim()
    ? `ORDER BY ${translation.order_by}`
    : 'ORDER BY created_at DESC';
  const limitClause = `LIMIT ${Math.min(limit, 100)} OFFSET ${offset}`;

  // Count query
  const countSQL = `SELECT COUNT(*) as count FROM skb_rows WHERE ${where}`;
  const [countRow] = await sql.unsafe(countSQL);
  const totalDocuments = Number(countRow.count);

  // Data query
  const dataSQL = `SELECT data FROM skb_rows WHERE ${where} ${orderBy} ${limitClause}`;
  const results = await sql.unsafe(dataSQL);

  return {
    results: results.map((r: any) => r.data),
    filter_applied: translation.where_clause,
    sort_applied: translation.order_by ?? 'created_at DESC',
    limit_applied: Math.min(limit, 100),
    total_documents: totalDocuments,
    returned: results.length,
  };
}
```

### 6.4 SQL Injection Safety

```typescript
const FORBIDDEN_PATTERNS = [
  /;\s*(DROP|ALTER|CREATE|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE)/i,
  /UNION\s+ALL/i,
  /INTO\s+OUTFILE/i,
  /LOAD_FILE/i,
  /information_schema/i,
  /pg_catalog/i,
  /pg_\w+/i,
  /\bEXECUTE\b/i,
  /\bPREPARE\b/i,
  /--.*$/m,
  /\/\*/,
];

function validateSQLSafety(clause: string): void {
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(clause)) {
      throw new Error(`SQL safety violation: potentially dangerous pattern detected`);
    }
  }
}
```

### 6.5 Category Filtering

Categories use PostgreSQL's JSONB containment operator `@>`:

```sql
-- Find rows where categories includes "sales" AND "q1"
SELECT data FROM skb_rows
WHERE categories @> '["sales", "q1"]'::jsonb
  AND container_id = $1
  AND tenant_id = $2;
```

This uses the GIN index on `categories` for efficient lookups.

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

## 8. File Change Plan

### 8.1 Implemented Files

#### `services/agent-admin-service/src/modules/structured-kb/` (as built)

```
structured-kb/
├── structured-kb.module.ts
├── structured-kb.controller.ts          ← query endpoint only
├── containers.controller.ts             ← container CRUD (new, not in original plan)
├── containers.service.ts                ← thin facade over skb-containers.service
├── skb-containers.service.ts
├── skb-containers.repository.ts
├── skb-rows.repository.ts
├── skb-schema.repository.ts             ← added (not in original plan)
├── skb-query.service.ts
├── skb-query-history.service.ts         ← added
├── skb-query-history.repository.ts      ← added
├── skb-row-index.service.ts             ← added (dynamic functional indexes)
├── skb-ingestion-worker.service.ts
├── skb-ingestion-watchdog.service.ts
├── skb-schema-analyzer.service.ts
├── skb-file-parser.ts
├── skb-sql-safety.ts
├── row-type-casting.ts                  ← extracted cast logic
├── skb-rate-limit.guard.ts              ← added
├── types/
│   └── skb.types.ts
└── dto/
    ├── create-skb.dto.ts
    ├── query-skb.dto.ts
    └── update-skb.dto.ts
```

> `SKBFilesService`, `SKBFilesRepository`, and `ingest-skb-file.dto.ts` were NOT created as
> standalone files. File ingestion state is managed within `SKBContainersService/Repository`.
> The `prompts/` subdirectory was not created — prompts are inline in service files.

### 8.2 Files to Modify

| File | Change |
|------|--------|
| `src/app.module.ts` | Import `StructuredKBModule` |
| `src/providers/schema-initializer.ts` | Add SKB tables DDL + indexes |
| `src/providers/nats.provider.ts` | Add `publishSKBFileIngestion()` method |

### 8.3 Detailed File Specifications

#### `structured-kb.module.ts`

The actual module registers two controllers and includes additional services
(`SKBQueryHistoryService`, `SKBRowIndexService`, `JobTrackingService`, `SKBRateLimitGuard`)
that were added during implementation:

```typescript
// Key shape — see src/modules/structured-kb/structured-kb.module.ts for the full list
@Module({
  controllers: [SKBContainersController, StructuredKBController],
  providers: [
    SKBContainersService, SKBContainersRepository,
    SKBFileParser, SKBSchemaAnalyzerService,
    SKBRowsRepository, SKBSchemaRepository,
    SKBQueryService,
    SKBIngestionWorkerService, SKBIngestionWatchdogService,
    SKBQueryHistoryService, SKBQueryHistoryRepository,
    SKBRowIndexService,
    JobTrackingService, SKBRateLimitGuard,
    // String-token providers for @Inject("...")
    { provide: "SKBSchemaRepository", useExisting: SKBSchemaRepository },
    { provide: "SKBRowsRepository", useExisting: SKBRowsRepository },
    { provide: "TenantConnectionManager", useExisting: YoizenclawTenantConnectionManager },
    { provide: "RowIndexSqlProvider", useExisting: YoizenclawTenantConnectionManager },
  ],
  exports: [SKBContainersService, SKBQueryService, SKBRowIndexService],
})
export class StructuredKBModule {}
```

> **Note**: `SKBFilesService` and `SKBFilesRepository` as separate classes do not exist.
> File operations are handled via `SKBContainersService` and `SKBContainersRepository`.

#### `skb-file-parser.ts`

Key responsibilities:
- Encoding detection (try UTF-8, fallback to `jschardet` or `iconv-lite`)
- CSV delimiter sniffing (port `_detect_delimiter` from Python)
- Excel parsing via `xlsx` (SheetJS) library
- Column name normalization (`normalizeColumnName` / `normalizeHeaders`)
- Header promotion for files with blank first rows
- Validation: max 100 columns, max 500k rows, min 1 data row
- Sampling strategy for LLM: first 5 + middle 10 + last 5 rows

Dependencies to add: `xlsx`, `jschardet` (or `encoding-japanese`), `papaparse`

```typescript
export class SKBFileParser {
  private static readonly MAX_COLUMNS = 100;
  private static readonly MAX_ROWS = 500_000;
  private static readonly SUPPORTED_EXTENSIONS = ['.csv', '.xlsx', '.xls'];

  async parseFile(
    fileBuffer: Buffer,
    filename: string,
    sheetName?: string,
  ): Promise<ParsedTable> { /* ... */ }
}
```

#### `skb-schema-analyzer.service.ts`

Uses AI SDK `generateObject` with Zod schema for structured output:

```typescript
@Injectable()
export class SKBSchemaAnalyzerService {
  async analyze(
    parsedTable: ParsedTable,
    providerConfig: ProviderConfig,
    model: string,
  ): Promise<SKBSchema> {
    const aiModel = this.createModel(providerConfig, model);
    const prompt = buildSchemaAnalysisPrompt(parsedTable);

    const { object } = await generateObject({
      model: aiModel,
      schema: SKBSchemaAnalysisZod,
      system: 'You are a data schema analyst. Analyze the provided tabular dataset sample and return a JSON schema following the exact format specified.',
      prompt,
      maxRetries: 2,
    });

    return this.buildSKBSchema(parsedTable, object);
  }
}
```

#### `skb-query.service.ts`

NL → SQL translation via `generateObject` + safe execution:

```typescript
@Injectable()
export class SKBQueryService {
  async query(
    tenantId: string,
    containerId: string,
    nlQuery: string,
    categories: string[],
    limit: number,
    offset: number,
    providerConfig: ProviderConfig,
    model: string,
  ): Promise<SKBQueryResult> {
    // 1. Load merged schema from all files in container
    const schemas = await this.loadAllSchemas(tenantId, containerId);

    // 2. Translate NL → SQL via LLM
    const translation = await this.translateQuery(
      nlQuery, schemas, categories, providerConfig, model,
    );

    // 3. Validate safety
    validateSQLSafety(translation.where_clause);
    if (translation.order_by) validateSQLSafety(translation.order_by);

    // 4. Execute
    const sql = await this.connectionManager.ensureSchema(tenantId);
    return executeSKBQuery(sql, containerId, tenantId, translation, categories, limit, offset);
  }
}
```

#### `skb-rows.repository.ts`

```typescript
@Injectable()
export class SKBRowsRepository {
  async insertBatch(
    sql: Sql,
    containerId: string,
    fileId: string,
    tenantId: string,
    categories: string[],
    rows: Record<string, unknown>[],
  ): Promise<number> {
    const BATCH_SIZE = 5000;
    let inserted = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const values = batch.map(row => ({
        container_id: containerId,
        file_id: fileId,
        tenant_id: tenantId,
        categories: JSON.stringify(categories),
        data: JSON.stringify(row),
      }));

      // Use multi-row INSERT for performance
      const cols = 'container_id, file_id, tenant_id, categories, data';
      const placeholders = values.map((_, idx) =>
        `($${idx * 5 + 1}, $${idx * 5 + 2}, $${idx * 5 + 3}, $${idx * 5 + 4}::jsonb, $${idx * 5 + 5}::jsonb)`
      ).join(', ');

      const flatParams = values.flatMap(v => [
        v.container_id, v.file_id, v.tenant_id, v.categories, v.data,
      ]);

      await sql.unsafe(
        `INSERT INTO skb_rows (${cols}) VALUES ${placeholders}`,
        flatParams,
      );
      inserted += batch.length;
    }

    return inserted;
  }

  async deleteByFile(
    sql: Sql,
    fileId: string,
    tenantId: string,
  ): Promise<number> {
    const result = await sql`
      DELETE FROM skb_rows
      WHERE file_id = ${fileId} AND tenant_id = ${tenantId}
    `;
    return result.count;
  }

  async deleteByContainer(
    sql: Sql,
    containerId: string,
    tenantId: string,
  ): Promise<number> {
    const result = await sql`
      DELETE FROM skb_rows
      WHERE container_id = ${containerId} AND tenant_id = ${tenantId}
    `;
    return result.count;
  }

  async countByContainer(
    sql: Sql,
    containerId: string,
    tenantId: string,
  ): Promise<number> {
    const [row] = await sql`
      SELECT COUNT(*) as count FROM skb_rows
      WHERE container_id = ${containerId} AND tenant_id = ${tenantId}
    `;
    return Number((row as any).count ?? 0);
  }
}
```

### 8.4 Schema Migrations

Add to `AGENT_ADMIN_SCHEMA_DDL` in `schema-initializer.ts`:

```sql
-- SKB tables
CREATE TABLE IF NOT EXISTS skb_containers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','ready','failed')),
  version VARCHAR(64) NOT NULL DEFAULT 'v1',
  ingest_model VARCHAR(128) DEFAULT 'gpt-4.1-mini',
  query_model VARCHAR(128) DEFAULT 'gpt-4.1-mini',
  provider_config JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, id, version)
);
CREATE INDEX IF NOT EXISTS idx_skb_containers_tenant ON skb_containers(tenant_id, is_active);

CREATE TABLE IF NOT EXISTS skb_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id UUID NOT NULL REFERENCES skb_containers(id) ON DELETE CASCADE,
  tenant_id VARCHAR(255) NOT NULL,
  file_id VARCHAR(255) NOT NULL,
  original_name VARCHAR(512) NOT NULL,
  detected_encoding VARCHAR(32),
  categories JSONB DEFAULT '[]'::jsonb,
  row_count INTEGER DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','completed','failed')),
  error_message TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (container_id, file_id)
);
CREATE INDEX IF NOT EXISTS idx_skb_files_container ON skb_files(container_id, is_active);
CREATE INDEX IF NOT EXISTS idx_skb_files_categories ON skb_files USING gin (categories);

CREATE TABLE IF NOT EXISTS skb_schemas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id UUID NOT NULL REFERENCES skb_containers(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES skb_files(id) ON DELETE CASCADE,
  tenant_id VARCHAR(255) NOT NULL,
  table_description TEXT,
  query_rules TEXT,
  columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  row_count INTEGER DEFAULT 0,
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (file_id)
);
CREATE INDEX IF NOT EXISTS idx_skb_schemas_container ON skb_schemas(container_id);

CREATE TABLE IF NOT EXISTS skb_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id UUID NOT NULL REFERENCES skb_containers(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES skb_files(id) ON DELETE CASCADE,
  tenant_id VARCHAR(255) NOT NULL,
  categories JSONB DEFAULT '[]'::jsonb,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  data_tsv TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(data::text, ''))
  ) STORED,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_skb_rows_container ON skb_rows(container_id);
CREATE INDEX IF NOT EXISTS idx_skb_rows_file ON skb_rows(file_id);
CREATE INDEX IF NOT EXISTS idx_skb_rows_categories ON skb_rows USING gin (categories);
CREATE INDEX IF NOT EXISTS idx_skb_rows_tsv ON skb_rows USING gin (data_tsv);

CREATE TABLE IF NOT EXISTS skb_query_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id UUID NOT NULL REFERENCES skb_containers(id),
  tenant_id VARCHAR(255) NOT NULL,
  natural_query TEXT NOT NULL,
  sql_where TEXT,
  sql_sort TEXT,
  result_count INTEGER DEFAULT 0,
  executed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_skb_query_history_container ON skb_query_history(container_id, executed_at DESC);
```

### 8.5 New npm Dependencies

```json
{
  "xlsx": "^0.18.5",
  "papaparse": "^5.4.1",
  "iconv-lite": "^0.6.3",
  "zod": "^3.23.0"
}
```

> Note: `ai` (^6.0.197) and `@ai-sdk/openai` (^3.0.68) are already in dependencies.
> The SKB module uses `generateObject` from `ai` v6 — note that `generateObject` is
> deprecated in v6 in favour of `generateText({ output: Output.object(...) })` but
> the migration has not been done yet.

### 8.6 Admin Console UI Components (Future — Phase 3)

| Component | Path | Description |
|-----------|------|-------------|
| `SKBListComponent` | `features/automation/skb/list/` | Container list view |
| `SKBDetailComponent` | `features/automation/skb/detail/` | Container detail + file list |
| `SKBFileUploadComponent` | `features/automation/skb/detail/` | Drag-drop CSV/Excel upload |
| `SKBQueryComponent` | `features/automation/skb/detail/` | NL query input + results table |
| `SKBSchemaViewerComponent` | `features/automation/skb/detail/` | Read-only schema display |
| `SKBService` | `core/services/` | HTTP client for SKB API |

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

## 10. Phased Implementation Plan

### Phase 1: Foundation (Week 1-2) — COMPLETED

**Goal**: Container CRUD + file parsing + schema DDL

- [x] Add SKB tables to `schema-initializer.ts`
- [x] Create `StructuredKBModule` with container CRUD
- [x] Implement `SKBFileParser` (CSV only first)
- [x] Create `SKBContainersService` + `SKBContainersRepository`
- [x] Create `SKBFilesService` + `SKBFilesRepository`
- [x] Create `StructuredKBController` with container + file endpoints
- [x] Register module in `app.module.ts`
- [x] Add NATS publish method for `skb_file_ingestion.v1`
- [x] Unit tests for file parser + column normalization

### Phase 2: Ingestion Pipeline (Week 3-4) — COMPLETED

**Goal**: Async ingestion + LLM schema analysis + row storage

- [x] Implement `SKBIngestionWorkerService` (NATS consumer)
- [x] Implement `SKBSchemaAnalyzerService` (AI SDK `generateObject`)
- [x] Implement `SKBRowsRepository` (batch INSERT)
- [x] Implement row type casting (numeric, boolean, date)
- [x] Add Excel parsing support (`xlsx` library)
- [x] Implement death checks + partial cleanup
- [x] Add `SKBIngestionWatchdogService` for stuck processing
- [x] Integration tests for full ingestion pipeline

### Phase 3: Query Pipeline + UI (Week 5-6) — COMPLETED

**Goal**: NL→SQL query + Admin Console views

- [x] Implement `SKBQueryService` (NL→SQL via `generateObject`)
- [x] Implement `skb-sql-safety.ts` validation
- [x] Implement query history recording
- [x] Add schema merging for multi-file containers
- [x] Admin Console: SKB list + detail components
- [x] Admin Console: file upload component
- [x] Admin Console: query component with results table
- [x] Admin Console: schema viewer component
- [x] E2E tests for query pipeline

### Phase 4: Hardening (Week 7-8) — COMPLETED

**Goal**: Performance, monitoring, edge cases

- [x] Dynamic functional indexes for high-cardinality numeric columns
- [x] Performance benchmarks for 100k+ row containers
- [x] Streaming CSV parsing for memory efficiency
- [x] Rate limiting on query endpoint
- [x] Grafana dashboard for SKB metrics (ingestion time, query latency, row counts)
- [x] Documentation + runbook
- [x] Security review of NL→SQL pipeline

---

## 11. API Reference

See [skb/api.md](./api.md) for the full API reference with request/response examples, error codes, and rate limiting details.

### Endpoint Summary

| Method | Path | Controller | Status |
|--------|------|------------|--------|
| `POST` | `/admin/structured-kb/containers` | `SKBContainersController` | Implemented |
| `GET` | `/admin/structured-kb/containers` | `SKBContainersController` | Implemented |
| `GET` | `/admin/structured-kb/containers/:id` | `SKBContainersController` | Implemented |
| `PATCH` | `/admin/structured-kb/containers/:id` | `SKBContainersController` | Implemented |
| `DELETE` | `/admin/structured-kb/containers/:id` | `SKBContainersController` | Implemented (204) |
| `POST` | `/admin/structured-kb/containers/:id/files` | api-gateway proxy | Implemented |
| `GET` | `/admin/structured-kb/containers/:id/files` | api-gateway proxy | Pending |
| `DELETE` | `/admin/structured-kb/containers/:id/files/:fileId` | api-gateway proxy | Pending |
| `GET` | `/admin/structured-kb/containers/:id/files/:fileId/schema` | api-gateway proxy | Pending |
| `POST` | `/admin/structured-kb/containers/:id/query` | `StructuredKBController` | Implemented |

---

## 12. Configuration Reference

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SKB_MAX_COLUMNS` | `100` | Maximum columns per file |
| `SKB_MAX_ROWS` | `500000` | Maximum rows per file |
| `SKB_BATCH_SIZE` | `5000` | Rows per INSERT batch |
| `SKB_INGEST_TIMEOUT_MS` | `300000` | Worker ack timeout (5 min — as implemented) |
| `SKB_DEFAULT_INGEST_MODEL` | `gpt-4.1-mini` | Default LLM for schema analysis |
| `SKB_DEFAULT_QUERY_MODEL` | `gpt-4.1-mini` | Default LLM for NL→SQL |
| `SKB_QUERY_MAX_LIMIT` | `1000` | Maximum query result limit |
| `SKB_LLM_MAX_RETRIES` | `2` | AI SDK retry count |
| `SKB_RATE_LIMIT_QUERY` | `60` | Query requests per minute per tenant |
| `SKB_RATE_LIMIT_INGEST` | `10` | Ingest requests per minute per tenant |

### Container `provider_config`

```typescript
interface ProviderConfig {
  provider: 'openai' | 'anthropic' | 'google' | 'custom';
  apiKey: string;
  apiBaseUrl?: string;
  model?: string;
}
```

### Container Status Flow

```
pending → processing → ready
                    ↘ failed
```

### File Status Flow

```
pending → processing → completed
                     ↘ failed
```

---

## 13. Troubleshooting Guide

### File ingestion stuck in `processing`

**Symptoms**: File status stays `processing` for more than 10 minutes.

**Cause**: Worker crash or NATS connection loss during ingestion.

**Resolution**:

1. Check worker logs: `kubectl logs -l app=agent-admin-service -c worker --tail=200`
2. Verify NATS connectivity — check the durable on each tenant stream:
   ```bash
   # List tenant ingress streams
   kubectl exec -it nats-box -- nats stream ls | grep '^INGRESS-'
   # Check consumer on a specific tenant stream
   kubectl exec -it nats-box -- nats consumer info INGRESS-<TENANT> skb-ingestion-worker
   ```
3. The `SKBIngestionWatchdogService` auto-resets stuck files after 10 minutes. If not:
   ```sql
   UPDATE skb_files SET status = 'failed', error_message = 'Manual reset'
   WHERE status = 'processing' AND updated_at < NOW() - INTERVAL '10 minutes';
   ```
4. Recompute container status after resetting files.

### Query returns 0 results

**Symptoms**: NL query matches data but returns empty.

**Cause**: SQL WHERE clause generated by LLM is too restrictive or uses wrong column names.

**Resolution**:

1. Check `skb_query_history` for the generated `sql_where` clause.
2. Verify column names match the schema (lowercase, underscore-normalized).
3. Test the WHERE clause directly against `skb_rows`:
   ```sql
   SELECT COUNT(*) FROM skb_rows
   WHERE container_id = '<id>' AND (<generated_where>);
   ```
4. If categories are set, verify they match: `SELECT DISTINCT categories FROM skb_rows WHERE container_id = '<id>'`.

### SQL safety violation on valid query

**Symptoms**: `"SQL safety violation: potentially dangerous pattern detected"`.

**Cause**: The LLM generated SQL containing a blocked pattern (e.g., comments `--`, `UNION`, or system table references).

**Resolution**:

1. Review the generated SQL in `skb_query_history.sql_where`.
2. If the pattern is a false positive (e.g., a column name containing `pg_`), add an exemption to `skb-sql-safety.ts`.
3. Improve the query prompt with more specific rules for the data domain.

### High memory usage during ingestion

**Symptoms**: Worker OOM on large files (>100k rows).

**Cause**: All rows held in memory during parsing + type casting.

**Resolution**:

1. Enable streaming CSV parsing via `papaparse` `step` callback.
2. Reduce batch size: set `SKB_BATCH_SIZE=2000`.
3. Increase worker memory: `--max-old-space-size=4096`.
4. For files >300k rows, consider splitting into multiple files.

### LLM schema analysis returns wrong types

**Symptoms**: Numeric columns detected as `text`, or dates not recognized.

**Cause**: LLM model lacks context for locale-specific formats.

**Resolution**:

1. Use a more capable model: set `ingest_model: "gpt-4.1"` on the container.
2. Add `query_rules` to the container describing the data domain.
3. Manually correct the schema and update `skb_schemas`:
   ```sql
   UPDATE skb_schemas SET columns = '<corrected_json>' WHERE file_id = '<file_id>';
   ```

### Grafana dashboard shows no data

**Symptoms**: All panels display "N/A" or empty.

**Cause**: Prometheus metrics not being exported by the service.

**Resolution**:

1. Verify the agent-admin-service exposes `/metrics` endpoint.
2. Check Prometheus scrape config targets the correct service.
3. Verify metric names match the dashboard:
   ```
   skb_containers_total
   skb_files_ingested_total
   skb_ingestion_duration_ms_bucket
   skb_rows_per_file_bucket
   skb_queries_total
   skb_query_duration_ms_bucket
   skb_query_errors_total
   skb_rows_per_container
   ```

---

## Appendix A: Type Casting Rules

Port of `_cast_value` from `mongo_service.py`:

```typescript
function castValue(value: string, colType: SKBColumnType): unknown {
  if (typeof value !== 'string' || value.trim() === '') return null;

  const v = value.trim();

  switch (colType) {
    case 'numeric': {
      const hasComma = v.includes(',');
      const hasDot = v.includes('.');

      let normalized: string;
      if (hasComma && hasDot) {
        const lastComma = v.lastIndexOf(',');
        const lastDot = v.lastIndexOf('.');
        normalized = lastComma > lastDot
          ? v.replace(/\./g, '').replace(',', '.')   // European: 1.250,00 → 1250.00
          : v.replace(/,/g, '');                      // English: 1,250.00 → 1250.00
      } else if (hasComma) {
        normalized = v.replace(',', '.');              // European: 6,90 → 6.90
      } else {
        normalized = v;
      }

      const f = parseFloat(normalized);
      if (isNaN(f)) return v;
      return Number.isInteger(f) ? f : f;
    }

    case 'boolean': {
      const lower = v.toLowerCase();
      if (['true', 'yes', '1', 'verdadero', 'si', 'sí'].includes(lower)) return true;
      if (['false', 'no', '0', 'falso'].includes(lower)) return false;
      return v;
    }

    default:
      return v;
  }
}

function castRow(
  row: Record<string, string>,
  columnTypes: Map<string, SKBColumnType>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const type = columnTypes.get(key);
    result[key] = type ? castValue(value, type) : value;
  }
  return result;
}
```

## Appendix B: Sample Row Sampling

Port of `get_sample_rows` from `file_parser.py`:

```typescript
function getSampleRows(
  rows: Record<string, string>[],
  n: number = 20,
): Record<string, string>[] {
  if (rows.length <= n) return rows;

  const total = rows.length;
  const firstN = 5;
  const lastN = 5;
  const midN = 10;

  const firstIndices = Array.from({ length: firstN }, (_, i) => i);
  const lastIndices = Array.from({ length: lastN }, (_, i) => total - lastN + i);

  const midCenter = Math.floor(total / 2);
  const midStart = Math.max(firstN, midCenter - Math.floor(midN / 2));
  const midEnd = Math.min(total - lastN, midStart + midN);
  const midIndices = Array.from({ length: midEnd - midStart }, (_, i) => midStart + i);

  const seen = new Set<number>();
  const selected: number[] = [];
  for (const idx of [...firstIndices, ...midIndices, ...lastIndices]) {
    if (!seen.has(idx)) {
      seen.add(idx);
      selected.push(idx);
    }
  }

  selected.sort((a, b) => a - b);
  return selected.map(i => rows[i]);
}
```

## Appendix C: Container Status Computation

Port of `_recompute_container_status` from `ingestion_service.py`:

```typescript
function recomputeContainerStatus(files: SKBFileRow[]): SKBContainerStatus {
  if (files.length === 0) return 'pending';
  if (files.some(f => f.status === 'processing')) return 'processing';
  if (files.every(f => f.status === 'completed')) return 'ready';
  if (files.some(f => f.status === 'completed')) return 'ready';
  return 'failed';
}
```
