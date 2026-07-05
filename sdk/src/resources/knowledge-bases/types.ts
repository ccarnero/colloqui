/**
 * Request/response types for the `knowledgeBases` resource, hand-typed
 * against the REAL gateway + downstream shapes (verified 2026-07-04, see
 * sdk/GROWTH-PLAN.md Phase 2):
 *
 * - `services/api-gateway/src/modules/admin/admin-knowledge-bases.controller.ts`
 *   defines `AdminKnowledgeBasesController` (`admin/knowledge-bases` CRUD) and
 *   `AdminKnowledgeBaseDocumentsController` (`admin/knowledge-bases/:kbId/documents/*`),
 *   both raw passthrough proxies via `AdminProxyService` (JSON-only —
 *   `admin-proxy.service.ts` always `JSON.stringify`s the body and sets
 *   `content-type: application/json`; there is no multipart passthrough).
 * - `services/agent-admin-service/src/modules/knowledge-bases/knowledge-bases.controller.ts`
 *   + `knowledge-bases.service.ts` (`IKnowledgeBaseRow`) for the KB CRUD shape.
 * - `services/agent-admin-service/src/modules/knowledge-bases/documents.controller.ts`
 *   + `documents.service.ts` (`IDocumentRow`, `IChunkRow`) for the documents
 *   sub-resource.
 * - `services/agent-admin-service/src/modules/knowledge-bases/documents.dto.ts`
 *   (`UploadDocumentDto`, `UploadFileDocumentDto`).
 *
 * Known gaps / gotchas:
 *
 * - `GET /admin/knowledge-bases` — the gateway forwards `limit`/`offset` query
 *   params (`admin-knowledge-bases.controller.ts` `findAll`), but the
 *   downstream `KnowledgeBasesService.findAll(tenantId)` takes NO
 *   limit/offset params at all and always returns every active row plus the
 *   real `total` count. In practice every call returns the full set
 *   regardless of the `limit`/`offset` sent — `hasMore` will read `false`
 *   from the very first page. `list()` still adapts through `toOffsetPage()`
 *   (matching the `admin/agents` convention) so the client shape is
 *   consistent and forward-compatible once the downstream implements real
 *   slicing; do not rely on multi-page iteration actually skipping rows
 *   today.
 * - `GET /admin/knowledge-bases/:id`, `PATCH /admin/knowledge-bases/:id` —
 *   the downstream service returns `null` (not a 404) when the id doesn't
 *   exist or isn't active (`findById`/`update` return `row ?? null`, and
 *   `KnowledgeBasesController` doesn't throw `NotFoundException` on a `null`
 *   result). The gateway proxy forwards that as HTTP 200 with a `null` body.
 *   `get()`/`update()` are typed `Promise<KnowledgeBase | null>` to reflect
 *   this — callers must null-check, they will NOT see a `NotFoundError`.
 * - `DELETE /admin/knowledge-bases/:id` — soft-delete; downstream returns a
 *   bare boolean (`result.length > 0`), not an object, not a 404 on missing
 *   id. `remove()` is typed `Promise<boolean>`.
 * - Same three gaps (`null` instead of 404 on get/update, bare boolean on
 *   delete, ignored limit/offset on list) apply identically to
 *   `documents.get()`/`documents.update is N/A`/`documents.remove()`/
 *   `documents.list()` — see `DocumentsService` in `documents.service.ts`.
 * - `GET /admin/knowledge-bases/:kbId/documents` — the gateway's
 *   `AdminKnowledgeBaseDocumentsController.findAll` forwards NO query params
 *   at all (not even limit/offset), and downstream returns every document
 *   unconditionally. `documents.list()` degrades this via `toSinglePage()`
 *   rather than `toOffsetPage()` since there is no pagination contract here
 *   whatsoever (unlike the KB list above, which at least has the query
 *   params wired through even if unused).
 * - `GET /admin/knowledge-bases/:kbId/documents/:id/chunks` — this is the
 *   ONE genuinely paginated endpoint in this resource: real `page`/`limit`
 *   query params, real SQL `LIMIT`/`OFFSET` slicing downstream
 *   (`DocumentsService.findChunksByDocumentId`), response envelope
 *   `{ chunks, total, page, limit, total_pages }`. `documents.listChunks()`
 *   adapts SDK `limit`/`offset` to `page`/`limit` via
 *   `page = floor(offset / limit) + 1` (same adapter as
 *   `workflows.listExecutions`) and reads `hasMore` off the real `total`.
 * - `POST /admin/knowledge-bases/:kbId/documents/upload-file` — despite the
 *   name, this is NOT a multipart endpoint. The downstream
 *   `UploadFileDocumentDto` is plain JSON: `{ filename, file_base64,
 *   content_type }` where `file_base64` is the file's raw bytes
 *   base64-encoded client-side (see `documents.service.ts`
 *   `createFromFile`/`extractTextFromFile`, which does
 *   `Buffer.from(base64Content, "base64")`). Since the gateway proxy is
 *   JSON-only anyway (see above), a real multipart `FormData` upload could
 *   never be proxied end-to-end even if the SDK built one — there is nothing
 *   to bridge. `documents.uploadFile()` is implemented as a plain JSON POST
 *   with a caller-supplied base64 string; no gap, no `FormData`/multipart
 *   code path needed.
 * - `findChunksByDocumentId` throws a plain `Error` (not `NotFoundException`)
 *   when the document doesn't exist, which NestJS's default exception
 *   filter maps to HTTP 500 — so `documents.listChunks()` for an unknown
 *   document id surfaces as a generic `SdkError` (`HTTP` code, status 500),
 *   not `NotFoundError`. Documented here rather than "fixed" client-side
 *   per the invariant that gateway/downstream inconsistencies get
 *   standardized upstream, not papered over in the SDK.
 * - `PUT /admin/knowledge-bases/:kbId/documents/:docId/chunks/:chunkId` —
 *   `docId`/`kbId` are routing path params only; the downstream
 *   `updateChunk(tenantId, chunkId, content)` looks the chunk up by
 *   `chunkId` + `tenantId` alone and does not verify it actually belongs to
 *   `docId`/`kbId`. Passed through as-is; not an SDK-level concern.
 */

/** Ingestion pipeline config, embedded on `KnowledgeBase.ingestion_config`. */
export interface KnowledgeBaseIngestionConfig {
  chunk_size?: number;
  chunk_overlap?: number;
  embedding_model?: string;
  provider_connector_id?: string;
  chunking_strategy?:
    | "character"
    | "recursive"
    | "semantic"
    | "title_segmentation";
  api_key?: string;
  provider?: string;
  api_base_url?: string;
  api_version?: string;
}

/** Response shape for create/get/list items/update (`IKnowledgeBaseRow`). */
export interface KnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  project: string | null;
  category: string | null;
  icon: string;
  ingestion_config: KnowledgeBaseIngestionConfig | null;
  is_active: boolean;
  /** ISO-8601 timestamp (serialized `Date`). */
  created_at: string;
  /** ISO-8601 timestamp (serialized `Date`). */
  updated_at: string;
}

/** `POST /admin/knowledge-bases` body (mirrors `CreateKnowledgeBaseDto`). */
export interface CreateKnowledgeBaseInput {
  name: string;
  description?: string;
  project?: string;
  category?: string;
  icon?: string;
  ingestion_config?: KnowledgeBaseIngestionConfig;
}

/** `PATCH /admin/knowledge-bases/:id` body (mirrors `UpdateKnowledgeBaseDto`). */
export interface UpdateKnowledgeBaseInput {
  name?: string;
  description?: string;
  project?: string;
  category?: string;
  icon?: string;
  ingestion_config?: KnowledgeBaseIngestionConfig;
}

export interface ListKnowledgeBasesParams {
  /** Page size sent as `limit`; see the ignored-downstream gap note above. Default 50. */
  pageSize?: number;
  /** Item offset sent as `offset`; see the ignored-downstream gap note above. Default 0. */
  startOffset?: number;
}

/** Raw envelope returned by `GET /admin/knowledge-bases` (`{ knowledge_bases, total }`). */
export interface ListKnowledgeBasesPage {
  knowledge_bases: KnowledgeBase[];
  total: number;
}

/** Response shape for a document row (`IDocumentRow`). */
export interface KnowledgeBaseDocument {
  id: string;
  tenant_id: string;
  knowledge_base_id: string;
  original_filename: string;
  mime_type: string;
  content_type: string;
  content_text: string | null;
  file_size: number;
  chunk_count: number;
  status: string;
  error_message: string | null;
  is_active: boolean;
  /** ISO-8601 timestamp (serialized `Date`). */
  created_at: string;
  /** ISO-8601 timestamp (serialized `Date`). */
  updated_at: string;
}

/** Raw envelope returned by `GET /admin/knowledge-bases/:kbId/documents` (`{ documents, total }`). */
export interface ListDocumentsPage {
  documents: KnowledgeBaseDocument[];
  total: number;
}

/** `POST /admin/knowledge-bases/:kbId/documents/upload` body (mirrors `UploadDocumentDto`). */
export interface UploadDocumentInput {
  content_text: string;
  original_filename: string;
  mime_type: string;
  content_type: "text" | "markdown" | "pdf" | "csv" | "html" | "docx";
}

/**
 * `POST /admin/knowledge-bases/:kbId/documents/upload-file` body (mirrors
 * `UploadFileDocumentDto`). `file_base64` is the raw file bytes,
 * base64-encoded by the caller — this is a plain JSON endpoint despite the
 * name, see the top-of-file gap note.
 */
export interface UploadFileDocumentInput {
  filename: string;
  file_base64: string;
  content_type: "auto" | "text" | "markdown" | "pdf" | "csv" | "html" | "docx";
}

/** Response for `upload()` / `uploadFile()` / `reingest()` — all 202 Accepted. */
export interface DocumentUploadResult {
  documentId: string;
  status: "pending";
}

/** One row of `GET /admin/knowledge-bases/:kbId/documents/:id/chunks` (derived from `IChunkRow`). */
export interface DocumentChunk {
  id: string;
  chunk_index: number;
  content: string;
  char_count: number;
  is_edited: boolean;
  /** ISO-8601 timestamp, or `null` when never edited. */
  edited_at: string | null;
}

export interface ListChunksParams {
  /** Page size sent as `limit`; API-enforced 1-100 (see `documents.controller.ts` `findChunks`). Default 50. */
  pageSize?: number;
  /** Item offset to start iterating from, adapted to `page` internally. Default 0. */
  startOffset?: number;
}

/** Raw envelope returned by the chunks endpoint (real `page`/`limit` pagination). */
export interface ChunksPage {
  chunks: DocumentChunk[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

/** `PUT /admin/knowledge-bases/:kbId/documents/:docId/chunks/:chunkId` body. */
export interface UpdateChunkInput {
  content: string;
}
