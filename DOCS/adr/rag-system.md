# ADR: Knowledge Base & RAG System for Agent Platform

**Status**: Partially implemented — Phase 1 (KB CRUD + document ingestion in `services/agent-admin-service/src/modules/knowledge-bases/`) and Phase 2 (KB RAG middleware, `knowledgeBaseIds` on agent config) are implemented. `createKnowledgeBaseRagMiddleware` in `services/agent-ai-service/src/modules/llm/rag-middleware.ts` performs pgvector cosine search against `document_chunks_embedding` via `KnowledgeBaseSearchService` and is wired into `llm-executor.service.ts`; the same file also keeps the older memory-service-backed `createRagMiddleware`. The async ingestion pipeline (NATS-based `ingestion-worker.service.ts`, job tracking, watchdog, PDF support) exists inline in `agent-admin-service` — the proposed dedicated `ingestion-service` microservice does not exist. The `getInformation` and `addResource` tools are NOT implemented — neither tool metadata nor handlers exist anywhere in the codebase (`src/modules/tools/builtin-tools/` contains only `communicate`, `load-skill`, and `memory` tools).
**Author**: Architect  
**Date**: 2026-06-07

---

## 1. Problem Statement

### What we're solving

Today the platform has a memory system (agent-memory-service) that stores per-user/per-session short-term facts and supports full-text search via Postgres `tsvector`. However:

1. **No long-term knowledge ingestion.** Users cannot upload documents (PDFs, text files, Markdown) and have an agent reference that knowledge at runtime. Every question must be answered from the LLM's training data or from what the user types in the chat.

2. **No structured knowledge base organization.** Documents exist as ad-hoc files. There is no concept of a "knowledge base" — a named collection of documents that can be tagged, categorized, and associated with agents.

3. **No vector search.** The memory service uses full-text search (`websearch_to_tsquery`), which is great for keyword matching but misses semantic similarity. "How do I reset my password?" won't find a document titled "Credential Recovery Process" unless the terms overlap literally.

4. **No RAG middleware for knowledge bases.** The existing `RagMiddleware` searches the memory service, not a knowledge base. Agent runtime has no mechanism to pull relevant document chunks before generating a response.

5. **No tools for KB interaction.** Agents cannot call `getInformation` (search KB) or `addResource` (add a fact to KB) as built-in tools.

### Why this matters

- **Accuracy.** RAG is the standard pattern for grounding LLM responses in proprietary data. Without it, agents hallucinate or say "I don't know" for questions about internal documentation, product manuals, or company policies.
- **Reusability.** A knowledge base of product documentation can be shared across multiple agents (support bot, onboarding bot, sales assistant) without copying data.
- **Admin control.** Knowledge base admins can upload, version, and manage documents centrally, then assign KBs to agents in the admin console.
- **Competitive parity.** Every major agent platform (Intercom, Zendesk, Salesforce, Copilot Studio) supports knowledge base ingestion + RAG.

---

## 2. Architecture Overview

### Service boundary diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                         Admin Console (Angular)                        │
│  ┌────────────┐  ┌──────────────┐  ┌─────────────┐  ┌──────────────┐ │
│  │ KB List    │  │ KB Detail    │  │ Upload      │  │ Agent Editor │ │
│  │ Page       │  │ Page         │  │ Dialog      │  │ KB Selector  │ │
│  └────────────┘  └──────────────┘  └─────────────┘  └──────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
         │ HTTP                     │ HTTP                  │ HTTP
         ▼                          ▼                       ▼
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────────┐
│ agent-admin-     │    │ agent-admin-     │    │ ingestion-service    │
│ service          │    │ service          │    │ (NEW)                │
│                  │    │                  │    │                      │
│ /admin/          │    │ /admin/          │    │ POST /ingest         │
│ knowledge-bases  │    │ knowledge-bases  │    │ POST /ingest/batch   │
│ (CRUD)           │    │ /:id/documents   │    │ GET  /ingest/:id     │
│                  │    │ (upload, list,   │    │ (status tracking)    │
│                  │    │  delete)         │    │                      │
└───────┬──────────┘    └───────┬──────────┘    └────────┬─────────────┘
        │                       │                        │
        │    ┌──────────────────┴──────────────────┐     │
        │    │                                     │     │
        ▼    ▼              Per-tenant PostgreSQL   ▼     │
┌───────────────────────────────────────────────────┐    │
│                                                   │    │
│  ┌──────────────┐  ┌──────────┐  ┌─────────────┐  │    │
│  │ knowledge_   │  │documents │  │document_    │  │    │
│  │ bases        │  │          │  │chunks       │  │    │
│  │              │  │          │  │(pgvector)   │  │    │
│  └──────────────┘  └──────────┘  └─────────────┘  │    │
│                                                   │    │
└───────────────────────────────────────────────────┘    │
        │                                                │
        │ HTTP (admin reads)                              │ Internal HTTP (ingestion)
        ▼                                                ▼
┌───────────────────────────────────────────────────────────────────────┐
│                      agent-ai-service (Runtime)                       │
│                                                                       │
│  ┌─────────────┐   ┌─────────────────┐   ┌─────────────────────────┐  │
│  │ Agent Config │──▶│   ChatService   │──▶│  LlmExecutorService    │  │
│  │ (has KB IDs) │   │                 │   │  (wrapLanguageModel)   │  │
│  └─────────────┘   │                 │   │                         │  │
│                    │  1. Load KB IDs  │   │  ┌───────────────────┐ │  │
│                    │  2. Build RAG    │   │  │ KnowledgeBaseRAG  │ │  │
│                    │     Middleware   │   │  │ Middleware        │ │  │
│                    │  3. Register     │   │  │ ┌─────────────┐   │ │  │
│                    │     getInfo/     │   │  │ │ 1. Embed    │   │ │  │
│                    │     addResource  │   │  │ │    query    │   │ │  │
│                    │     tools        │   │  │ └──────┬──────┘   │ │  │
│                    │                 │   │  │        ▼          │ │  │
│                    └──────┬──────────┘   │  │ ┌─────────────┐   │ │  │
│                           │              │  │ │ 2. Search   │   │ │  │
│                           ▼              │  │ │  pgvector   │   │ │  │
│                    ┌──────────────┐      │  │ │  cosine     │   │ │  │
│                    │  Agent       │      │  │ │  distance   │   │ │  │
│                    │  Runtime     │      │  │ └──────┬──────┘   │ │  │
│                    │  (tools +    │      │  │        ▼          │ │  │
│                    │   executor)  │      │  │ ┌─────────────┐   │ │  │
│                    └──────────────┘      │  │ │ 3. Inject   │   │ │  │
│                                          │  │ │  context    │   │ │  │
│                                          │  │ └─────────────┘   │ │  │
│                                          │  └───────────────────┘ │  │
│                                          └─────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────┘
```

### Data flow: Upload → Chunk → Embed → Store

```
┌────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌─────────┐
│Upload  │──▶│Extract   │──▶│ Chunk    │──▶│ Embed    │──▶│ Store   │
│File    │   │Text      │   │ Text     │   │ (embed   │   │ (pgvec- │
│(PDF/   │   │(txt2txt, │   │(sentence │   │  Many)   │   │ tor)    │
│ .md/   │   │ pdf-     │   │ splitter)│   │          │   │         │
│ .txt)  │   │ parse)   │   │          │   │          │   │         │
└────────┘   └──────────┘   └──────────┘   └──────────┘   └─────────┘
                                                    │
                                                    ▼
                                             ┌──────────────┐
                                             │ NATS event:  │
                                             │ ingestion.   │
                                             │ completed    │
                                             └──────────────┘
```

### Data flow: Query → Embed → Search → Inject → Generate (Runtime RAG)

```
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│User      │──▶│Embed     │──▶│ Search   │──▶│ Inject   │──▶│ LLM      │
│Messages  │   │Query     │   │pgvector  │   │ Context  │   │Generate  │
│          │   │(embed-   │   │(cosine   │   │ into     │   │Response  │
│          │   │Single)   │   │ dist <   │   │ user     │   │          │
│          │   │          │   │ 0.5)     │   │ message  │   │          │
└──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘
                                      │
                                      ▼
                               ┌──────────────┐
                               │ Top-K chunks │
                               │ (ranked by   │
                               │  similarity) │
                               └──────────────┘
```

---

## 3. Data Model

### 3a. New tables in per-tenant PostgreSQL

#### `knowledge_bases`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY DEFAULT gen_random_uuid() | Unique identifier |
| `tenant_id` | VARCHAR(32) | NOT NULL | Tenant scope |
| `name` | VARCHAR(255) | NOT NULL | KB name (e.g. "Product Docs") |
| `description` | TEXT | | Optional description |
| `project` | VARCHAR(255) | | Project/folder grouping |
| `category` | VARCHAR(255) | | Tag/category label |
| `icon` | VARCHAR(64) | DEFAULT 'library_books' | Material icon for UI |
| `is_active` | BOOLEAN | DEFAULT true | Soft-delete flag |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

**Indexes:**
- `idx_kb_tenant ON knowledge_bases(tenant_id, is_active)`
- `idx_kb_project ON knowledge_bases(tenant_id, project) WHERE is_active = true`
- `idx_kb_name ON knowledge_bases(tenant_id, name) WHERE is_active = true`

#### `documents`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY DEFAULT gen_random_uuid() | Unique identifier |
| `tenant_id` | VARCHAR(32) | NOT NULL | Tenant scope |
| `knowledge_base_id` | UUID | NOT NULL REFERENCES knowledge_bases(id) | Parent KB |
| `filename` | VARCHAR(512) | NOT NULL | Storage filename (UUID-based) |
| `original_filename` | VARCHAR(512) | NOT NULL | Original uploaded name |
| `mime_type` | VARCHAR(128) | NOT NULL | e.g. application/pdf, text/plain, text/markdown |
| `content_type` | VARCHAR(20) | NOT NULL CHECK (content_type IN ('text', 'markdown', 'pdf', 'csv', 'html')) | Simplified type |
| `content_text` | TEXT | | Extracted plain text (nullable for large docs streamed by ingestion service) |
| `file_size` | INTEGER | NOT NULL DEFAULT 0 | Size in bytes |
| `chunk_count` | INTEGER | NOT NULL DEFAULT 0 | Number of chunks produced |
| `status` | VARCHAR(20) | NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','ready','failed')) | Ingestion status |
| `error_message` | TEXT | | Error details if failed |
| `is_active` | BOOLEAN | DEFAULT true | Soft-delete flag |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

**Indexes:**
- `idx_docs_kb ON documents(knowledge_base_id, is_active)`
- `idx_docs_tenant ON documents(tenant_id, is_active)`
- `idx_docs_status ON documents(status) WHERE status IN ('pending','processing')`

#### `document_chunks`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY DEFAULT gen_random_uuid() | Unique identifier |
| `tenant_id` | VARCHAR(32) | NOT NULL | Tenant scope |
| `document_id` | UUID | NOT NULL REFERENCES documents(id) ON DELETE CASCADE | Parent document |
| `knowledge_base_id` | UUID | NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE | Parent KB (denormalized for search) |
| `chunk_index` | INTEGER | NOT NULL | Position in document |
| `content` | TEXT | NOT NULL | The chunk text |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

**Indexes:**
- `idx_chunks_doc ON document_chunks(document_id)`
- `idx_chunks_kb ON document_chunks(knowledge_base_id)`

#### `document_chunks_embedding`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `chunk_id` | UUID | PRIMARY KEY REFERENCES document_chunks(id) ON DELETE CASCADE | FK to chunk |
| `embedding` | vector(1536) | NOT NULL | OpenAI text-embedding-3-small dimension |

**Indexes:**
- `idx_chunks_embedding ON document_chunks_embedding USING ivfflat (embedding vector_cosine_ops)` — OR `USING hnsw (embedding vector_cosine_ops)` for Phase 2+

> **Index choice**: Start with `ivfflat` with `lists = 100` for fast indexing on moderate data sizes. Move to `hnsw` if query latency becomes an issue at scale (>100K chunks). `hnsw` builds slower but queries are an order of magnitude faster.

### 3b. Modified: Agent config (`agents` table)

Add one column:

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `knowledge_base_ids` | UUID[] / JSONB | `[]` | Array of KB UUIDs associated with this agent |

### 3c. Modified: `IAgentConfig` (agent-ai-service)

```typescript
// Add to agent-config.repository.interface.ts
export interface IAgentConfig {
  // ... existing fields ...
  readonly knowledgeBaseIds: string[];   // NEW
}
```

### 3d. New shared types (`packages/shared/src/` or within respective service)

```typescript
// Knowledge base types — place in packages/shared/src/knowledge-base.interfaces.ts
export interface IKnowledgeBase {
  id: string;
  tenantId: string;
  name: string;
  description?: string | null;
  project?: string | null;
  category?: string | null;
  icon?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IDocumentSummary {
  id: string;
  knowledgeBaseId: string;
  originalFilename: string;
  mimeType: string;
  contentType: string;
  fileSize: number;
  chunkCount: number;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  errorMessage?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IChunkResult {
  content: string;
  score: number;
  documentId: string;
  documentName: string;
  kbId: string;
}
```

---

## 4. API Design

### 4a. Knowledge Base CRUD (`agent-admin-service`)

All endpoints under `/admin/knowledge-bases`, guarded by `TenantGuard`, read `x-yoizen-tenant` header.

| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| GET | `/admin/knowledge-bases` | List all KBs | - | `{ knowledgeBases: IKnowledgeBase[], total: number }` |
| GET | `/admin/knowledge-bases/:id` | Get KB by ID | - | `IKnowledgeBase` |
| POST | `/admin/knowledge-bases` | Create KB | `CreateKnowledgeBaseDto` | `IKnowledgeBase` |
| PATCH | `/admin/knowledge-bases/:id` | Update KB | `UpdateKnowledgeBaseDto` | `IKnowledgeBase` |
| DELETE | `/admin/knowledge-bases/:id` | Soft-delete KB | - | `{ deleted: true }` |

**`CreateKnowledgeBaseDto`:**
```typescript
class CreateKnowledgeBaseDto {
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsOptional() description?: string;
  @IsString() @IsOptional() project?: string;
  @IsString() @IsOptional() category?: string;
  @IsString() @IsOptional() icon?: string;
}
```

**`UpdateKnowledgeBaseDto`:** Same fields, all optional.

### 4b. Document Management (`agent-admin-service`)

| Method | Endpoint | Description | Request | Response |
|--------|----------|-------------|---------|----------|
| GET | `/admin/knowledge-bases/:kbId/documents` | List documents in KB | Query: `status`, `limit`, `offset` | `{ documents: IDocumentSummary[], total: number }` |
| POST | `/admin/knowledge-bases/:kbId/documents` | Upload document(s) | `multipart/form-data` (file field) | `{ documents: IDocumentSummary[] }` |
| GET | `/admin/knowledge-bases/:kbId/documents/:docId` | Get document detail | - | `IDocumentSummary` |
| DELETE | `/admin/knowledge-bases/:kbId/documents/:docId` | Soft-delete document + chunks | - | `{ deleted: true }` |
| POST | `/admin/knowledge-bases/:kbId/documents/:docId/reindex` | Re-process document | - | `{ status: 'pending' }` |

**Upload handling:**
1. Receive `multipart/form-data` with one or more files
2. Create `documents` row(s) with `status = 'pending'`
3. Store file in local temp or object storage (Phase 1: memory buffer; Phase 2: S3/MinIO)
4. If **sync mode** (small files, Phase 1): extract text, chunk, embed, update status
5. If **async mode** (large files, Phase 2+): enqueue to ingestion-service via NATS or HTTP, return immediately

### 4c. Ingestion Service (NEW microservice)

| Method | Endpoint | Description | Request | Response |
|--------|----------|-------------|---------|----------|
| POST | `/ingest` | Ingest a single document | `{ tenantId, documentId, kbId, content, mimeType }` | `{ status: 'processing' }` |
| POST | `/ingest/batch` | Ingest multiple documents | `{ tenantId, documents: [...] }` | `{ status: 'processing', count: N }` |
| GET | `/ingest/:documentId/status` | Get ingestion progress | - | `{ status, chunkCount, error }` |

### 4d. RAG Runtime Endpoints (`agent-ai-service`)

No new HTTP endpoints — RAG is middleware, not an API. But the following internal interfaces:

| Method / Tool | Description |
|---------------|-------------|
| `getInformation` tool | Agent-ad-hoc KB search. Params: `{ query: string, knowledgeBaseIds?: string[], topK?: number }` |
| `addResource` tool | Add a fact to a KB at runtime. Params: `{ content: string, knowledgeBaseId: string, source?: string }` |

### 4e. Agent-to-KB Association (`agent-admin-service`)

| Method | Endpoint | Description | Request Body |
|--------|----------|-------------|--------------|
| PATCH | `/admin/agents/:id/knowledge-bases` | Set associated KBs for an agent | `{ knowledge_base_ids: string[] }` |

---

## 5. Ingestion Pipeline

### Flow: Upload → Chunk → Embed → Store

```
┌─────────────────────────────────────────────────────────────────────┐
│ POST /admin/knowledge-bases/:kbId/documents                         │
│ (multipart/form-data)                                                │
└─────────────────────┬───────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 1. Create document row (status = 'pending')                        │
│ 2. Return { id, status: 'pending' } to client                      │
└─────────────────────┬───────────────────────────────────────────────┘
                      │
                      ▼ (async — NATS event or internal call)
┌─────────────────────────────────────────────────────────────────────┐
│ 3. Extract text based on mime_type:                                │
│    - text/plain      → identity                                    │
│    - text/markdown   → identity                                    │
│    - application/pdf → pdf-parse (or pdf.js)                       │
│    - text/csv        → simple line split                           │
│    - text/html       → strip tags via html-to-text                 │
│                                                                     │
│ 4. Update document.status = 'processing'                            │
└─────────────────────┬───────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 5. generateChunks(content): string[]                                │
│    Strategy: sentence-bounded paragraph splitting                   │
│    - Split by double newline first (paragraphs)                     │
│    - If paragraph > 512 tokens, split by sentence boundary          │
│    - If sentence > 512 tokens, split by word boundary               │
│    - Overlap: 1 sentence between chunks                             │
│    - Target chunk size: 256–512 tokens (~200–400 words)             │
│                                                                     │
│ 6. For each chunk, insert document_chunks row                       │
└─────────────────────┬───────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 7. embedMany(chunks) → [{ embedding, tokens }]                     │
│    Using EmbeddingService with text-embedding-3-small               │
│    Batch size: 20 chunks per call (avoids rate limits)              │
│                                                                     │
│ 8. For each chunk+embedding pair:                                   │
│    INSERT INTO document_chunks_embedding (chunk_id, embedding)      │
│    VALUES (${chunkId}, ${embedding}::vector)                         │
└─────────────────────┬───────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 9. Update document:                                                 │
│    - status = 'ready'                                               │
│    - chunk_count = chunks.length                                    │
│    - content_text = extracted text (for debugging / re-index)       │
│                                                                     │
│ 10. Optional: NATS event ingestion.completed                        │
└─────────────────────────────────────────────────────────────────────┘
```

### Chunking strategy decision

| Strategy | Pros | Cons |
|----------|------|------|
| **A. Sentence-bounded paragraph (CHOSEN)** | Preserves paragraph integrity, natural boundaries, good for prose | Not ideal for CSV/structured data |
| **B. Fixed-size token window** | Uniform chunk sizes, simple | Cuts sentences mid-thought, context loss |
| **C. Recursive character splitter** | Common in LangChain, well-understood | Arbitrary boundaries, no semantic respect |

Why A wins: The platform deals primarily with natural language documents (product docs, manuals, FAQs). Paragraphs are the natural unit of thought. A sentence-bounded fallback prevents oversized chunks.

### Text extraction per file type

| Type | Library | Notes |
|------|---------|-------|
| `.txt` | identity | Direct text |
| `.md` | identity | Markdown is valid text; optionally strip markup |
| `.pdf` | `pdf-parse` (npm) | Extracts text content; no layout preservation needed |
| `.csv` | custom parser | Row-per-chunk or entire file as one chunk |
| `.html` | `html-to-text` | Strip tags, extract readable content |

---

## 6. Runtime RAG Flow

### 6a. Knowledge Base RAG Middleware

A new `LanguageModelMiddleware` that sits alongside or replaces the existing `RagMiddleware` when an agent has knowledge bases associated.

```
┌──────────────────────────────────────────────────────────────────┐
│ KnowledgeBaseRagMiddleware.transformParams                        │
│                                                                   │
│ 1. Extract last user message from prompt                          │
│ 2. Get agent's knowledge_base_ids from IAgentConfig               │
│ 3. If no KBs assigned → skip (passthrough)                        │
│ 4. Embed the query via EmbeddingService.embedSingle()             │
│ 5. Search pgvector across all assigned KBs:                      │
│                                                                   │
│    SELECT c.id, c.content, c.chunk_index,                        │
│           1 - (e.embedding <=> ${queryEmbedding}::vector)         │
│           AS similarity                                           │
│    FROM document_chunks c                                         │
│    JOIN document_chunks_embedding e ON e.chunk_id = c.id         │
│    WHERE c.knowledge_base_id = ANY(${kbIds})                      │
│      AND c.tenant_id = ${tenantId}                                │
│    ORDER BY e.embedding <=> ${queryEmbedding}::vector             │
│    LIMIT ${topK}                                                  │
│                                                                   │
│ 6. Filter: keep only similarity > 0.5                             │
│ 7. Build context string:                                          │
│    "---\nKnowledge base results:\n[1] <chunk content>\n[2] ..."   │
│ 8. Truncate to maxContextChars (4000)                              │
│ 9. Append to last user message                                    │
│                                                                   │
│ 10. On failure: passthrough (RAG should never break the call)    │
└──────────────────────────────────────────────────────────────────┘
```

### 6b. `getInformation` tool

A built-in tool that agents can call explicitly to search the knowledge base.

```typescript
export function createGetInformationToolDef(): ToolDef {
  return {
    name: "getInformation",
    description:
      "Search the knowledge base for information relevant to the user's query. " +
      "Use this when you need facts, documentation, or reference material " +
      "that may be stored in the knowledge base.",
    builtin: true,
    readOnly: true,
    maxOutputChars: 16_384,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query to find relevant information",
        },
        knowledgeBaseIds: {
          type: "array",
          items: { type: "string" },
          description: "Optional: restrict search to specific KBs (defaults to all assigned)",
        },
        topK: {
          type: "number",
          description: "Number of results to return (default: 5, max: 20)",
          minimum: 1,
          maximum: 20,
        },
      },
      required: ["query"],
    },
  };
}
```

**Handler logic:**
1. Embed the `query` using `EmbeddingService.embedSingle()`
2. If `knowledgeBaseIds` provided, filter to those; otherwise use agent's assigned KBs
3. Search pgvector with `topK` (default 5), similarity threshold > 0.5
4. Return ranked chunks as a JSON array with content, score, document name

### 6c. `addResource` tool

Allows agents to persist a fact to a knowledge base at runtime.

```typescript
export function createAddResourceToolDef(): ToolDef {
  return {
    name: "addResource",
    description:
      "Add a new piece of information to the knowledge base. " +
      "Use this to store facts, documentation, or reference material " +
      "that the agent learns during conversation.",
    builtin: true,
    readOnly: false,
    maxOutputChars: 1024,
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The content/text to add to the knowledge base",
        },
        knowledgeBaseId: {
          type: "string",
          description: "The ID of the knowledge base to add to",
        },
        source: {
          type: "string",
          description: "Optional source label (e.g. 'chat-conversation', 'admin-input')",
        },
      },
      required: ["content", "knowledgeBaseId"],
    },
  };
}
```

**Handler logic:**
1. Create a document row with `status = 'processing'`, `content_type = 'text'`
2. Chunk the content (single chunk for small texts)
3. Embed via `embedSingle` (for single-chunk) or `embedMany` (multi-chunk)
4. Store chunk + embedding in pgvector
5. Update document status to 'ready'
6. Return `{ success: true, documentId, chunkCount }`

### 6d. Agent system prompt augmentation

When an agent has knowledge bases assigned, the system prompt is augmented with:

```
You have access to a knowledge base containing relevant documentation and reference material.
Use the 'getInformation' tool to find relevant information BEFORE answering questions.
If you find relevant information, cite it in your response.
If the information is not in the knowledge base, say so — do not make up information.
```

This augmentation is injected programmatically at runtime (not persisted in the agent config's `systemPrompt`), so the knowledge base association can change without editing prompts.

### 6e. Middleware registration in ChatService

```
ChatService.prepareExecution():
  ┌─ 1. Load agent config (IAgentConfig)
  ├─ 2. If knowledgeBaseIds.length > 0:
  │      a. Build KnowledgeBaseRagMiddleware with tenant's pgvector pool
  │      b. Register getInformation and addResource tools
  │      c. Augment system prompt with KB instructions
  ├─ 3. Wrap language model:
  │      wrapLanguageModel({
  │        model,
  │        middleware: [kbRagMiddleware, existingRagMiddleware, ...]
  │      })
  └─ 4. Proceed with existing flow
```

---

## 7. UI Design

### 7a. Navigation

Add `/ai/knowledge-bases` as a new route under the AI section:

```
AI Landing
├── Agents
├── Knowledge Bases      ← NEW
├── Skills
├── Memories
└── System Variables
```

### 7b. Knowledge Bases List Page

**Route**: `/ai/knowledge-bases`

**Components**:
- `kb-list-page.component` — Main page component
- `kb-list-table.component` — Table with columns: Name, Project, Category, Documents count, Status, Actions
- `kb-create-dialog.component` — Dialog for creating a new KB

**Features**:
- Search/filter by name, project, category
- Create KB with name, description, project, category fields
- Click row to navigate to KB detail
- Delete with confirmation dialog

### 7c. Knowledge Base Detail Page

**Route**: `/ai/knowledge-bases/:id`

**Components**:
- `kb-detail-page.component` — Main page with tabs
- `kb-documents-list.component` — Document table
- `kb-upload-dialog.component` — File upload with drag-drop
- `kb-document-row.component` — Single document with status indicator

**Tabs**:
1. **Documents** — Document list table:
   - Columns: Filename, Type, Size, Chunks, Status, Uploaded, Actions
   - Status chips: pending (grey), processing (blue animated), ready (green), failed (red)
   - Actions: Delete, Re-index
   - Upload button → opens drag-drop dialog
2. **Settings** — KB metadata editing (name, description, project, category)

**Upload dialog**:
- Drag & drop zone + file picker button
- Accept: `.pdf`, `.txt`, `.md`, `.csv`, `.html`
- Progress indicator per file (if async)
- After upload: refresh document list

### 7d. Agent Editor — KB Selector

In the agent editor (`/ai/agents/:id/configure`), add a "Knowledge Bases" section:

- Multi-select dropdown with all available KBs
- Shows KB name + project
- Selected KBs shown as chips with remove button
- Saves to `knowledge_base_ids` on the agent config

### 7e. Component tree

```
ai/
├── knowledge-bases/
│   ├── kb-list-page.component
│   │   ├── kb-create-dialog.component
│   │   └── kb-list-table.component
│   └── kb-detail-page.component
│       ├── kb-documents-list.component
│       ├── kb-upload-dialog.component
│       └── kb-settings-form.component
├── agents/
│   └── detail/
│       └── ai-agent-editor-page.component
│           └── agent-kb-selector.component    ← NEW inline component
```

---

## 8. Implementation Phases

### Phase 1: Foundation — KB CRUD + Basic Ingestion (MVP)

**Goal**: Admin can create KBs, upload text files, and see them in the admin UI. Single-tenant synchronous ingestion.

| # | Task | Service(s) | Est. effort |
|---|------|------------|-------------|
| 1.1 | Enable pgvector extension (`CREATE EXTENSION vector;`) in per-tenant Postgres schema init | agent-admin-service, agent-memory-service schema | 1 file |
| 1.2 | Create `knowledge_bases`, `documents`, `document_chunks`, `document_chunks_embedding` tables with DDL SQL | agent-admin-service (new schema file) | 1 file |
| 1.3 | Add `knowledge_base_ids` column to `agents` table DDL | agent-admin-service | 1 line |
| 1.4 | Add `knowledgeBaseIds` to `IAgentConfig` interface + Postgres repository mapping | agent-ai-service | ~20 lines |
| 1.5 | Add shared KB types to `@yoizen/shared` or in-service | agent-admin-service | 1 file |
| 1.6 | KB CRUD module: controller, service, DTO (follow system-variables pattern) | agent-admin-service | ~200 lines |
| 1.7 | Document upload endpoint (sync, text-only): extract text, chunk, embed via `EmbeddingService`, store to pgvector | agent-admin-service | ~300 lines |
| 1.8 | Document list + delete endpoints | agent-admin-service | ~100 lines |
| 1.9 | Admin Console: KB list page + create dialog | admin-console | ~350 lines |
| 1.10 | Admin Console: KB detail page with document table + upload | admin-console | ~400 lines |
| 1.11 | Admin Console: Agent editor KB selector | admin-console | ~100 lines |
| 1.12 | Schema DDL file for new tables, integrated into `TenantConnectionManager.ensureSchema()` | agent-admin-service | ~50 lines |
| 1.13 | Tests | all affected | ~300 lines |

**Deliverable**: Admin can create a KB, upload text files, see documents processed, and associate KB with an agent (but runtime RAG is not yet active).

### Phase 2: RAG Runtime — Context Injection + Tools

**Goal**: Agents with KB associations automatically search the KB at runtime. `getInformation` and `addResource` tools are available.

| # | Task | Service(s) | Est. effort |
|---|------|------------|-------------|
| 2.1 | Create `KnowledgeBaseRagMiddleware` (LanguageModelMiddleware) that searches pgvector per-tenant | agent-ai-service (llm module) | ~150 lines |
| 2.2 | Integrate KB config loading into ChatService / execution handler: pass `knowledgeBaseIds` to middleware factory | agent-ai-service (chat module) | ~50 lines |
| 2.3 | Augment system prompt with KB instructions when KBs are assigned | agent-ai-service (chat module) | ~20 lines |
| 2.4 | Create `getInformation` built-in tool (def + handler) | agent-ai-service (builtin-tools) | ~100 lines |
| 2.5 | Create `addResource` built-in tool (def + handler) | agent-ai-service (builtin-tools) | ~100 lines |
| 2.6 | Register tools + middleware in execution pipeline | agent-ai-service (tools module) | ~30 lines |
| 2.7 | Add pgvector search query logic to the RAG middleware (cosine distance via `<=>` operator) | agent-ai-service | ~60 lines |
| 2.8 | Tests: RAG middleware, tools, integration with LLM executor | agent-ai-service | ~200 lines |

**Deliverable**: When a user asks a question, the runtime automatically finds relevant chunks from assigned KBs and injects them as context. Agents can also use `getInformation` explicitly.

### Phase 3: Advanced Features — PDF Support, Async Ingestion, Organization

**Goal**: Full-featured KB system with async processing, PDF support, projects/categories, file management UI.

| # | Task | Service(s) | Est. effort |
|---|------|------------|-------------|
| 3.1 | Add PDF text extraction via `pdf-parse` to ingestion pipeline | agent-admin-service / ingestion-service | ~30 lines |
| 3.2 | Add CSV and HTML support | agent-admin-service | ~40 lines |
| 3.3 | Create dedicated `ingestion-service` microservice with NATS events for async processing | NEW service | ~400 lines |
| 3.4 | Implement async mode: upload creates document row, enqueues to NATS, ingestion-service processes and updates status | agent-admin-service + ingestion-service | ~200 lines |
| 3.5 | Add projects/categories filtering to KB list API + UI | agent-admin-service + admin-console | ~100 lines |
| 3.6 | Admin Console: drag-drop upload with progress indicators | admin-console | ~150 lines |
| 3.7 | Admin Console: status polling for in-progress documents | admin-console | ~80 lines |
| 3.8 | Re-index endpoint: delete chunks, re-process document, re-embed | agent-admin-service | ~60 lines |
| 3.9 | Move to `hnsw` index if query performance requires it | agent-admin-service (migration) | ~20 lines |
| 3.10 | Tests | all affected | ~300 lines |

**Deliverable**: Production-ready KB system with async ingestion, multi-format support, and organizational features.

---

## 9. Tradeoffs & Alternatives Considered

### A. Vector storage: pgvector vs dedicated vector DB vs in-memory

| Option | Pros | Cons |
|--------|------|------|
| **A1. pgvector on existing per-tenant Postgres (CHOSEN)** | No new infrastructure, reuses `TenantConnectionManager`, per-tenant isolation, ACID compliance with documents | `ivfflat` has build time vs recall tradeoffs; `hnsw` is memory-heavy for large datasets |
| **A2. Pinecone / Weaviate / Qdrant** | Purpose-built for vector search, faster queries at scale, managed | New infrastructure, operational cost, cross-service auth, no per-tenant isolation model |
| **A3. In-memory (current `findSimilar`)** | Zero infra, simple | Not persistent, doesn't scale, lost on restart, no multi-tenant isolation |

**Why A1 wins**: The platform already runs per-tenant Postgres. pgvector is a Postgres extension — no new service to deploy, monitor, or secure. Per-tenant isolation is free (each tenant has their own DB/schema). For the expected scale (thousands of chunks per tenant, not millions), pgvector with `ivfflat` or `hnsw` is more than adequate.

### B. Ingestion: sync vs async

| Option | Pros | Cons |
|--------|------|------|
| **B1. Synchronous (P1) + async (P3) (CHOSEN)** | Simple to start, immediate feedback; async added later for large files | Two implementations to maintain temporarily |
| **B2. Fully async from day one** | Single code path, handles large files immediately | Complex startup, requires ingestion-service from day 1, overkill for text files |
| **B3. Fully synchronous always** | Simplest, no new service | Blocks upload endpoint for large PDFs, poor UX for 50-page documents |

**Why B1 wins**: Phase 1 users upload text files that process in <1 second. Synchronous is fine. Phase 3 adds async for PDF-heavy workloads. The document model (`status` column) supports both modes from day one.

### C. Chunking strategy

| Strategy | Pros | Cons |
|----------|------|------|
| **C1. Sentence-bounded paragraph (CHOSEN)** | Natural semantic units, good retrieval quality | Over-sized paragraphs produce large chunks |
| **C2. Fixed token count** | Predictable chunk sizes | Cuts sentences, loses context |
| **C3. Recursive character splitter** | Well-known, LangChain standard | Arbitrary boundaries |
| **C4. Semantic chunking (embed-based boundaries)** | Best semantic coherence | Expensive (requires embedding to find boundaries), slow |

**Why C1 wins**: Best balance of quality and simplicity. Paragraphs are natural semantic units. Sentence-boundary fallback prevents oversized chunks. Semantic chunking can be added later as an optimization.

### D. Where to run the RAG middleware: agent-ai-service vs ingestion-service

| Option | Pros | Cons |
|--------|------|------|
| **D1. RAG in agent-ai-service (CHOSEN)** | Low latency (same process), direct access to pgvector pool, follows existing RAG middleware pattern | Requires pgvector connection pool in agent-ai-service |
| **D2. RAG via ingestion-service HTTP** | Cleaner separation, ingestion-service doesn't need LLM dependencies | Extra HTTP hop on every request, latency, new failure domain |

**Why D1 wins**: The agent-ai-service already opens per-tenant Postgres pools via `TenantConnectionManager`. Adding pgvector queries to the same pool is natural. The RAG middleware is a `LanguageModelMiddleware` — it runs in-process with the LLM call. An external HTTP call would add ~100ms+ per request for minimal benefit.

### E. Agent-KB association: config-level vs tool-level

| Option | Pros | Cons |
|--------|------|------|
| **E1. KB IDs on agent config (CHOSEN)** | Middleware auto-injects context without agent prompt changes; admin controls which KBs each agent sees | Agent cannot dynamically choose different KBs per request |
| **E2. KB IDs passed in chat request** | Caller decides which KBs to search per invocation | Admin loses control, every SDK call needs KB awareness |
| **E3. KB IDs in system prompt** | Simple, no new config field | Prompt becomes bloated, KB refs are IDs not content |

**Why E1 wins**: The agent config is the natural boundary. An admin assigns KBs to an agent in the admin console, and the runtime respects that. The agent doesn't need to know about KBs — context is injected transparently. If the agent needs ad-hoc access, `getInformation` tool accepts `knowledgeBaseIds` override.

### F. Embedding dimension: 1536 vs 3072 vs smaller

| Option | Pros | Cons |
|--------|------|------|
| **F1. text-embedding-3-small (1536d) (CHOSEN)** | Already used in `EmbeddingService`, cheaper, faster, 1536d is well-supported by pgvector | Slightly less accurate than 3-large for edge cases |
| **F2. text-embedding-3-large (3072d)** | Higher accuracy | More expensive, larger index, slower queries on pgvector |
| **F3. Local embedding (e.g. all-MiniLM-L6-v2)** | No API dependency, free | Lower quality, requires local model hosting |

**Why F1 wins**: The platform already uses `text-embedding-3-small` in `EmbeddingService`. Consistency matters — one embedding model means all vectors are comparable. 1536 dimensions is well-supported by pgvector `vector_cosine_ops`. Cost: $0.13/1M tokens (vs $0.13 for small, $0.13 for large — same price actually). The accuracy difference is marginal for document retrieval use cases.

---

## 10. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| pgvector `ivfflat` recall degrades with data churn | Low | Medium | Monitor query quality; migrate to `hnsw` in Phase 3 if needed |
| Embedding API rate limits on large uploads | Medium | Low | Batch `embedMany` calls (20 at a time); add retry with backoff |
| Large PDFs blocking the admin HTTP endpoint | Medium | High | Async ingestion via ingestion-service in Phase 3; timeout-protect sync path |
| RAG context making prompts too large for context window | Low | Medium | Enforce `maxContextChars` (4000 default); truncate gracefully; log warnings |
| User uploads malicious file | Low | High | Validate mime type on server; reject binaries; scan size limits |
| Tenant isolation broken in pgvector queries | Very Low | Critical | Always filter by `tenant_id` in every query; covered by unit tests |

---

## 11. Open Questions

1. **File storage**: Phase 1 stores files in-memory during upload. Should Phase 2 use S3/MinIO or keep a `file_data` bytea column in the `documents` table? **Decision needed in Phase 2.**
2. **Chunk overlap size**: 1 sentence overlap is the default. Should this be configurable per KB? (Add `chunk_overlap` to KB settings in Phase 3.)
3. **Embedding model for non-English**: The platform is Spanish-first. `text-embedding-3-small` handles Spanish well, but should we offer per-KB model configuration?
4. **Re-index cost**: Re-indexing a 100-page document re-chunks and re-embeds everything. Should we show a confirmation with estimated cost in tokens?

---

## 12. Files Affected (estimated)

### Phase 1 (Foundation)

| File | Change |
|------|--------|
| `packages/shared/src/knowledge-base.interfaces.ts` | **NEW** — shared KB types |
| `services/agent-admin-service/src/schema/rag-schema.sql` | **NEW** — DDL for KB, documents, chunks, embeddings tables |
| `services/agent-admin-service/src/providers/schema-initializer.ts` | Register new DDL |
| `services/agent-admin-service/src/modules/knowledge-bases/` | **NEW** — CRUD module (controller, service, DTO) |
| `services/agent-admin-service/src/modules/knowledge-bases/documents/` | **NEW** — document upload, list, delete (controller, service) |
| `services/agent-admin-service/src/app.module.ts` | Import new modules |
| `services/agent-ai-service/src/modules/agents/agent-config.repository.interface.ts` | Add `knowledgeBaseIds` |
| `services/agent-ai-service/src/modules/agents/agent-config.postgres.repository.ts` | Map `knowledge_base_ids` |
| `services/admin-console/src/app/app.routes.ts` | Add `/ai/knowledge-bases` routes |
| `services/admin-console/src/app/features/automation/ai/knowledge-bases/` | **NEW** — KB list + detail pages |
| `services/admin-console/src/app/core/services/knowledge-bases.service.ts` | **NEW** — HTTP service |

### Phase 2 (RAG Runtime)

| File | Change |
|------|--------|
| `services/agent-ai-service/src/modules/llm/kb-rag-middleware.ts` | **NEW** — KnowledgeBaseRagMiddleware |
| `services/agent-ai-service/src/modules/tools/builtin-tools/get-information.tool.ts` | **NEW** — built-in tool |
| `services/agent-ai-service/src/modules/tools/builtin-tools/add-resource.tool.ts` | **NEW** — built-in tool |
| `services/agent-ai-service/src/modules/tools/tools.module.ts` | Register new tools |
| `services/agent-ai-service/src/modules/chat/chat.service.ts` | Integrate KB middleware + prompt augmentation |
| `services/agent-ai-service/src/modules/llm/llm.module.ts` | Export embedding service for middleware |

### Phase 3 (Advanced)

| File | Change |
|------|--------|
| `services/ingestion-service/` | **NEW** microservice |
| `services/agent-admin-service/src/modules/knowledge-bases/documents/documents.service.ts` | Add PDF, CSV, HTML support |
| `services/admin-console/src/app/features/automation/ai/knowledge-bases/` | Drag-drop, progress, project filters |

---

## Appendix: pgvector Index Selection

```sql
-- Phase 1: ivfflat (fast build, good for <100K rows)
CREATE INDEX idx_chunks_embedding_ivfflat
  ON document_chunks_embedding
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Phase 3: hnsw (fast query, better for >100K rows, more memory)
CREATE INDEX idx_chunks_embedding_hnsw
  ON document_chunks_embedding
  USING hnsw (embedding vector_cosine_ops);
```

**`ivfflat` vs `hnsw` tradeoff**: `ivfflat` builds in minutes but queries are approximate with tunable recall via `lists` parameter. `hnsw` builds slower (hours for 1M rows) but queries are ~10x faster with higher recall. Start with `ivfflat`; migrate to `hnsw` if query latency exceeds 200ms at p99.
