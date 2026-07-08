# SKB API Reference

*SKB is a module inside `agent-admin-service` (`src/modules/structured-kb/`, `SERVICE_MODE=api|worker`) — there is no standalone SKB service.*

> Complete API reference for the Structured Knowledge Base (SKB) service.

---

## Base URL

All SKB endpoints are proxied through the API Gateway:

```
https://{env}.{tenant}.yplatform.com/admin/structured-kb
```

### Authentication

All endpoints require:

| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | Yes | `Bearer <JWT>` — issued by auth-service |
| `x-yoizen-tenant` | Yes | Tenant identifier (also resolved from hostname) |

---

## Containers

### Create Container

```
POST /admin/structured-kb/containers
```

Creates a new SKB container for structured data ingestion.

**Request Body:**

```json
{
  "name": "Sales Q1 2026",
  "description": "Quarterly sales data for analysis",
  "version": "v1",
  "ingest_model": "gpt-4.1-mini",
  "query_model": "gpt-4.1-mini",
  "provider_config": {
    "provider": "openai",
    "apiKey": "sk-...",
    "apiBaseUrl": "https://api.openai.com/v1"
  }
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | Yes | — | Container display name |
| `description` | string | No | `null` | Human-readable description |
| `version` | string | No | `"v1"` | Schema version tag |
| `ingest_model` | string | No | `"gpt-4.1-mini"` | LLM model for schema analysis |
| `query_model` | string | No | `"gpt-4.1-mini"` | LLM model for NL→SQL translation |
| `provider_config` | object | No | `{}` | AI provider configuration |

**Response `201 Created`:**

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "tenant_id": "acme",
  "name": "Sales Q1 2026",
  "description": "Quarterly sales data for analysis",
  "status": "pending",
  "version": "v1",
  "ingest_model": "gpt-4.1-mini",
  "query_model": "gpt-4.1-mini",
  "provider_config": {},
  "is_active": true,
  "created_at": "2026-06-08T10:00:00Z",
  "updated_at": "2026-06-08T10:00:00Z"
}
```

---

### List Containers

```
GET /admin/structured-kb/containers
```

Returns all SKB containers for the current tenant.

**Response `200 OK`:**

```json
[
  {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "name": "Sales Q1 2026",
    "status": "ready",
    "version": "v1",
    "is_active": true,
    "created_at": "2026-06-08T10:00:00Z",
    "updated_at": "2026-06-08T10:05:00Z"
  }
]
```

---

### Get Container

```
GET /admin/structured-kb/containers/:id
```

Returns a single container with file summary.

**Response `200 OK`:**

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "tenant_id": "acme",
  "name": "Sales Q1 2026",
  "description": "Quarterly sales data for analysis",
  "status": "ready",
  "version": "v1",
  "ingest_model": "gpt-4.1-mini",
  "query_model": "gpt-4.1-mini",
  "provider_config": {},
  "is_active": true,
  "created_at": "2026-06-08T10:00:00Z",
  "updated_at": "2026-06-08T10:05:00Z"
}
```

---

### Update Container

```
PATCH /admin/structured-kb/containers/:id
```

Updates container metadata. Only provided fields are updated. `UpdateSKBDto`
accepts only `name` and `description` — `query_model`, `ingest_model`, and
`provider_config` cannot be updated via this endpoint (the repository only ever
writes `name`, `description`, and `status`).

**Request Body:**

```json
{
  "name": "Sales Q1-Q2 2026",
  "description": "Quarterly sales data for analysis (Q1 + Q2)"
}
```

**Response `200 OK`:** Returns updated container object.

---

### Delete Container

```
DELETE /admin/structured-kb/containers/:id
```

Soft-deletes a container (sets `is_active = false` on the `skb_containers` row
only). Files, schemas, and rows are NOT touched — the `ON DELETE CASCADE`
foreign keys only fire on a hard `DELETE`, which never happens here.

**Response `204 No Content`** (no body).

---

## Files

> **Current implementation status:** SKB file routes are not ready for use. The
> api-gateway exposes `POST /admin/structured-kb/containers/:id/files`, but it
> proxies to an `agent-admin-service` route that is not implemented. List,
> delete, and schema file routes are also not implemented in
> `agent-admin-service` controllers. Treat this section as the intended contract
> until the missing agent-admin routes are added.

### Upload File for Ingestion

```
POST /admin/structured-kb/containers/:id/files
```

Uploads a CSV or Excel file for asynchronous ingestion. The file is queued via NATS JetStream and processed by the SKB ingestion worker.

**Request Body:**

```json
{
  "file_id": "sales-q1-jan",
  "filename": "sales_january_2026.csv",
  "file_base64": "Um93LFByb2R1Y3QsUHJpY2UsRGF0ZQoxLExhcHRvcCw5OTkuOTksMjAyNi0wMS0xNQ==",
  "categories": ["sales", "q1"],
  "sheet_name": "Data"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file_id` | string | Yes | Caller-assigned logical file identifier (unique per container) |
| `filename` | string | Yes | Original filename with extension (`.csv`, `.xlsx`, `.xls`) |
| `file_base64` | string | Yes | Base64-encoded file content |
| `categories` | string[] | No | Tags for category-based filtering |
| `sheet_name` | string | No | Excel sheet to parse (first sheet if omitted) |

**Response `202 Accepted`:**

```json
{
  "fileId": "f7e6d5c4-b3a2-1098-7654-fedcba098765",
  "fileLogicalId": "sales-q1-jan",
  "status": "pending",
  "message": "File queued for ingestion"
}
```

**Current behavior:** this gateway route is pending/broken because the target
`agent-admin-service` route does not exist yet.

**Constraints:**

| Limit | Value |
|-------|-------|
| Max columns | 100 |
| Max rows per file | 500,000 |
| Min data rows | 1 |
| Supported formats | `.csv`, `.xlsx`, `.xls` |
| Max file size (base64) | ~50 MB |

---

### List Files in Container

```
GET /admin/structured-kb/containers/:id/files
```

**Current behavior:** not implemented in `agent-admin-service`.

**Response `200 OK`:**

```json
[
  {
    "id": "f7e6d5c4-b3a2-1098-7654-fedcba098765",
    "container_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "file_id": "sales-q1-jan",
    "original_name": "sales_january_2026.csv",
    "detected_encoding": "utf-8",
    "categories": ["sales", "q1"],
    "row_count": 15000,
    "status": "completed",
    "error_message": null,
    "is_active": true,
    "created_at": "2026-06-08T10:01:00Z",
    "updated_at": "2026-06-08T10:01:45Z"
  }
]
```

**File statuses:**

| Status | Meaning |
|--------|---------|
| `pending` | Queued, not yet picked up by worker |
| `processing` | Worker is parsing + analyzing + inserting rows |
| `completed` | Successfully ingested |
| `failed` | Ingestion failed — see `error_message` |

---

### Delete File

```
DELETE /admin/structured-kb/containers/:id/files/:fileId
```

**Current behavior:** not implemented in `agent-admin-service`.

Removes a file and all its rows from the container.

**Response `200 OK`:**

```json
{
  "deleted_file_id": "f7e6d5c4-b3a2-1098-7654-fedcba098765",
  "deleted_rows": 15000
}
```

---

### Get File Schema

```
GET /admin/structured-kb/containers/:id/files/:fileId/schema
```

**Current behavior:** not implemented in `agent-admin-service`.

Returns the LLM-analyzed schema for a specific file.

**Response `200 OK`:**

```json
{
  "id": "s1d2e3f4-a5b6-7890-cdef-123456789012",
  "file_id": "f7e6d5c4-b3a2-1098-7654-fedcba098765",
  "container_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "table_description": "Monthly sales transactions with product details, pricing, and regional breakdown",
  "query_rules": "Always filter by date range when temporal queries are made. Price columns are in USD.",
  "columns": [
    {
      "name": "row",
      "original_name": "Row",
      "type": "numeric",
      "description": "Row number / sequential ID",
      "sample_values": ["1", "2", "3"],
      "is_filterable": true,
      "query_hints": ["Use for ordering", "Not a primary key"]
    },
    {
      "name": "product",
      "original_name": "Product",
      "type": "categorical",
      "description": "Product name",
      "sample_values": ["Laptop", "Mouse", "Keyboard"],
      "is_filterable": true,
      "query_hints": ["Use exact match or IN clause"]
    },
    {
      "name": "price",
      "original_name": "Price",
      "type": "numeric",
      "description": "Unit price in USD",
      "sample_values": ["999.99", "29.99", "79.50"],
      "is_filterable": true,
      "query_hints": ["Numeric range comparisons supported"]
    },
    {
      "name": "date",
      "original_name": "Date",
      "type": "date",
      "description": "Transaction date",
      "sample_values": ["2026-01-15", "2026-01-16", "2026-01-17"],
      "is_filterable": true,
      "query_hints": ["Use PostgreSQL date functions"]
    }
  ],
  "row_count": 15000,
  "analyzed_at": "2026-06-08T10:01:30Z"
}
```

**Column types:**

| Type | Description | Typical SQL operator |
|------|-------------|---------------------|
| `text` | Free-form text | `ILIKE` |
| `categorical` | Low-cardinality enum | `=`, `IN` |
| `numeric` | Numbers (int/float) | `=`, `>`, `<`, `BETWEEN` |
| `date` | Date/timestamp | `>`, `<`, date functions |
| `boolean` | True/false | `IS TRUE`, `IS FALSE` |
| `unknown` | Undetermined | `ILIKE` fallback |

---

## Query

### Execute NL Query

```
POST /admin/structured-kb/containers/:id/query
```

Translates a natural language query to SQL, executes it against the container's rows, and returns matching data.

**Request Body:**

```json
{
  "query": "Show me all laptop sales over $500 in January",
  "categories": ["sales"],
  "limit": 20,
  "offset": 0
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `query` | string | Yes | — | Natural language query |
| `categories` | string[] | No | `[]` | Filter by category tags |
| `limit` | number | No | `100` | Max results (1–1000, validated by `QuerySKBDto`) |
| `offset` | number | No | `0` | Pagination offset |

**Response `200 OK`:**

```json
{
  "results": [
    {
      "row": 42,
      "product": "Laptop",
      "price": 999.99,
      "date": "2026-01-15"
    },
    {
      "row": 87,
      "product": "Laptop Pro",
      "price": 1499.00,
      "date": "2026-01-20"
    }
  ],
  "sql": "SELECT data FROM skb_rows WHERE container_id = '...' AND tenant_id = '...' AND ((data->>'product')::text ILIKE '%laptop%') ORDER BY created_at DESC LIMIT 20 OFFSET 0",
  "totalCount": 2
}
```

---

## Error Responses

All endpoints return errors in a consistent format:

```json
{
  "statusCode": 400,
  "message": "Query must not be empty",
  "error": "Bad Request"
}
```

### Error Codes

| HTTP Status | Code | Description |
|-------------|------|-------------|
| `400` | `Bad Request` | Invalid input (empty query, bad limit, malformed base64, unsupported file format) |
| `401` | `Unauthorized` | Missing or invalid JWT token |
| `403` | `Forbidden` | JWT token tenant does not match request tenant |
| `404` | `Not Found` | Container or file does not exist |
| `409` | `Conflict` | Duplicate `file_id` within a container |
| `413` | `Payload Too Large` | File exceeds max size or row count limits |
| `422` | `Unprocessable Entity` | File parsing failed, empty file, or no data rows |
| `429` | `Too Many Requests` | Rate limit exceeded |
| `500` | `Internal Server Error` | LLM call failure, database error, or unexpected server error |
| `503` | `Service Unavailable` | Worker not running or NATS connection lost |

### Query-Specific Errors

| Scenario | Status | Message |
|----------|--------|---------|
| Empty query string | `400` | `"Query must not be empty"` |
| Limit out of range | `400` | `"Limit must be between 1 and 1000"` |
| Negative offset | `400` | `"Offset must be non-negative"` |
| SQL safety violation | `500` | `"SQL safety violation: potentially dangerous pattern detected"` |
| LLM translation failure | `500` | `"Failed to translate query"` |

> Note: there is NO container-status check on the query path — querying a
> `pending` or `failed` container is not rejected.

---

## Rate Limiting

`SKBRateLimitGuard` is applied to the query endpoint only. File upload rate limiting is
not implemented in `agent-admin-service`.

| Endpoint | Limit | Window | Enforcement |
|----------|-------|--------|-------------|
| `POST .../query` | 30 requests | per minute per tenant per process | In-memory `SKBRateLimitGuard` in agent-admin-service |
| `POST .../files` | — | — | Not implemented; gateway route target is missing |
| All other endpoints | — | — | No SKB-specific limiter |

The query limiter does not emit `X-RateLimit-*` response headers.

When rate limited, the response is:

```json
{
  "statusCode": 429,
  "message": "Rate limit exceeded. Max 30 queries per minute per tenant.",
  "error": "Too Many Requests"
}
```

---

## Container Status Lifecycle

```
pending → processing → ready
                    ↘ failed
```

| Transition | Trigger |
|------------|---------|
| `pending` → `processing` | First file ingestion starts |
| `processing` → `ready` | All files in container reach `completed` |
| `processing` → `ready` | At least one file `completed`, none `processing` |
| any → `failed` | All files failed |
| `ready` → `processing` | New file uploaded to ready container |

---

## Ingestion Pipeline

```
POST /files → NATS publish → Worker picks up → Parse file → LLM schema analysis
  → Type-cast rows → Batch INSERT (5000/batch) → Mark completed
```

**Current implementation note:** the worker-side ingestion consumer exists,
but the public file upload route is not wired end-to-end because the
`agent-admin-service` file upload controller route is missing (nothing
publishes the `skb_file_ingestion.v1` event the worker consumes). The
worker pipeline's own wiring gaps — file-status updates targeting a
non-existent `skb_container_files` table, the `insertRows()` `as any` arity
mismatch, and the `row_data`/`file_index` column mismatch — have been fixed:
file-status updates now target `skb_files` (created by the schema
initializer), `insertRows()` is called with an honest 6-argument signature
(no cast), and `skb_rows` now has a `file_index` column that `insertRows()`/
`getRows()` actually use.

**Timeout**: NATS ack wait is 5 minutes (`ackWaitMs: 300_000`). The ingestion
watchdog resets files stuck in `processing` for more than 10 minutes; its
stuck-file lookup (`findProcessingFilesOlderThan`) now queries `skb_files`
across every tenant the process has a connection open for, so automatic
resets happen in practice.

**Batch size**: 5,000 rows per INSERT batch.

**Row sampling for LLM**: the schema analyzer currently sends only the first 5
rows (`parsed.rows.slice(0, 5)`). A `getSampleRows()` helper implementing
first 5 + middle 10 + last 5 sampling exists in `skb-file-parser.ts` but is not
called by the analyzer.
