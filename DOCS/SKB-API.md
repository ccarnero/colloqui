# SKB API Reference

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

Updates container configuration. Only provided fields are updated.

**Request Body:**

```json
{
  "name": "Sales Q1-Q2 2026",
  "query_model": "gpt-4.1",
  "provider_config": {
    "provider": "anthropic",
    "apiKey": "sk-ant-...",
    "model": "claude-sonnet-4-20250514"
  }
}
```

**Response `200 OK`:** Returns updated container object.

---

### Delete Container

```
DELETE /admin/structured-kb/containers/:id
```

Soft-deletes a container (sets `is_active = false`). Cascades to all files, schemas, and rows.

**Response `200 OK`:**

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "is_active": false
}
```

---

## Files

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
| `limit` | number | No | `10` | Max results (1–1000) |
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
  "filter_applied": "(data->>'product')::text ILIKE '%laptop%' AND (data->>'price')::numeric > 500",
  "sort_applied": "(data->>'date') DESC",
  "limit_applied": 20,
  "total_documents": 2,
  "returned": 2
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
| Container not ready | `400` | `"Container is not in ready state"` |

---

## Rate Limiting

| Endpoint | Limit | Window |
|----------|-------|--------|
| `POST .../query` | 60 requests | per minute per tenant |
| `POST .../files` | 10 requests | per minute per tenant |
| All other endpoints | 120 requests | per minute per tenant |

Rate limit headers are included in every response:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1717843200
```

When rate limited, the response is:

```json
{
  "statusCode": 429,
  "message": "Rate limit exceeded. Retry after 30s.",
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

**Timeout**: 15 minutes per file. Stuck files are reset by the ingestion watchdog service.

**Batch size**: 5,000 rows per INSERT batch.

**Row sampling for LLM**: First 5 + middle 10 + last 5 rows (up to 20 total).
