import type { Paginated } from "../../core/pagination.js";
import { paginate, toOffsetPage, toSinglePage } from "../../core/pagination.js";
import type { RetryConfig } from "../../core/retry.js";
import type { Transport } from "../../core/transport.js";
import type {
  ChunksPage,
  CreateKnowledgeBaseInput,
  DocumentChunk,
  DocumentUploadResult,
  KnowledgeBase,
  KnowledgeBaseDocument,
  ListChunksParams,
  ListDocumentsPage,
  ListKnowledgeBasesPage,
  ListKnowledgeBasesParams,
  UpdateChunkInput,
  UpdateKnowledgeBaseInput,
  UploadDocumentInput,
  UploadFileDocumentInput,
} from "./types.js";

export interface KnowledgeBasesClientDeps {
  transport: Transport;
}

export interface KnowledgeBaseCallOptions {
  /** Per-call retry override; `false` disables retries for this call only. */
  retry?: RetryConfig | false;
}

export interface KnowledgeBaseDocumentsClient {
  /** `GET /admin/knowledge-bases/:kbId/documents` — bare envelope, no pagination contract; degraded to a single page. */
  list(kbId: string): Paginated<KnowledgeBaseDocument>;
  /** `GET /admin/knowledge-bases/:kbId/documents/:id`. Returns `null` (HTTP 200) instead of throwing when not found — see types.ts. */
  get(
    kbId: string,
    id: string,
    opts?: KnowledgeBaseCallOptions
  ): Promise<KnowledgeBaseDocument | null>;
  /** `GET /admin/knowledge-bases/:kbId/documents/:id/chunks` — real `page`/`limit` pagination, adapted via `toOffsetPage`. */
  listChunks(
    kbId: string,
    id: string,
    params?: ListChunksParams
  ): Paginated<DocumentChunk>;
  /** `PUT /admin/knowledge-bases/:kbId/documents/:docId/chunks/:chunkId`. */
  updateChunk(
    kbId: string,
    docId: string,
    chunkId: string,
    input: UpdateChunkInput,
    opts?: KnowledgeBaseCallOptions
  ): Promise<DocumentChunk>;
  /** `POST /admin/knowledge-bases/:kbId/documents/upload` — plain-text document; 202 Accepted. */
  upload(
    kbId: string,
    input: UploadDocumentInput,
    opts?: KnowledgeBaseCallOptions
  ): Promise<DocumentUploadResult>;
  /**
   * `POST /admin/knowledge-bases/:kbId/documents/upload-file` — JSON body
   * with a base64-encoded file (NOT multipart; see types.ts); 202 Accepted.
   */
  uploadFile(
    kbId: string,
    input: UploadFileDocumentInput,
    opts?: KnowledgeBaseCallOptions
  ): Promise<DocumentUploadResult>;
  /** `POST /admin/knowledge-bases/:kbId/documents/:id/reingest`; 202 Accepted. */
  reingest(
    kbId: string,
    id: string,
    opts?: KnowledgeBaseCallOptions
  ): Promise<DocumentUploadResult>;
  /** `DELETE /admin/knowledge-bases/:kbId/documents/:id`. Returns a bare boolean — see types.ts. */
  remove(
    kbId: string,
    id: string,
    opts?: KnowledgeBaseCallOptions
  ): Promise<boolean>;
}

export interface KnowledgeBasesClient {
  /** `POST /admin/knowledge-bases`. */
  create(
    input: CreateKnowledgeBaseInput,
    opts?: KnowledgeBaseCallOptions
  ): Promise<KnowledgeBase>;
  /**
   * `GET /admin/knowledge-bases` — real `limit`/`offset` query params are
   * sent, but the downstream ignores them today (always returns the full
   * set); see types.ts. Adapted via `toOffsetPage` for forward-compat.
   */
  list(params?: ListKnowledgeBasesParams): Paginated<KnowledgeBase>;
  /** `GET /admin/knowledge-bases/:id`. Returns `null` (HTTP 200) instead of throwing when not found — see types.ts. */
  get(
    id: string,
    opts?: KnowledgeBaseCallOptions
  ): Promise<KnowledgeBase | null>;
  /** `PATCH /admin/knowledge-bases/:id`. Returns `null` (HTTP 200) instead of throwing when not found — see types.ts. */
  update(
    id: string,
    input: UpdateKnowledgeBaseInput,
    opts?: KnowledgeBaseCallOptions
  ): Promise<KnowledgeBase | null>;
  /** `DELETE /admin/knowledge-bases/:id` — soft-delete. Returns a bare boolean — see types.ts. */
  remove(id: string, opts?: KnowledgeBaseCallOptions): Promise<boolean>;
  /** `admin/knowledge-bases/:kbId/documents/*` sub-resource. */
  documents: KnowledgeBaseDocumentsClient;
}

/**
 * Creates the `knowledgeBases` namespace client. Follows the `workflows`
 * reference implementation (GROWTH-PLAN.md Phase 2) — see sdk/README.md
 * "Resource clients".
 */
export function createKnowledgeBasesClient({
  transport,
}: KnowledgeBasesClientDeps): KnowledgeBasesClient {
  function encodePath(id: string): string {
    return encodeURIComponent(id);
  }

  async function create(
    input: CreateKnowledgeBaseInput,
    opts: KnowledgeBaseCallOptions = {}
  ): Promise<KnowledgeBase> {
    const { body } = await transport.request<KnowledgeBase>({
      path: "/admin/knowledge-bases",
      method: "POST",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  function list(
    params: ListKnowledgeBasesParams = {}
  ): Paginated<KnowledgeBase> {
    return paginate<KnowledgeBase>(
      async ({ limit, offset }) => {
        const query = new URLSearchParams({
          limit: String(limit),
          offset: String(offset),
        });
        const { body } = await transport.request<ListKnowledgeBasesPage>({
          path: `/admin/knowledge-bases?${query.toString()}`,
          method: "GET",
        });
        return toOffsetPage(body.knowledge_bases, body.total, offset);
      },
      { pageSize: params.pageSize, startOffset: params.startOffset }
    );
  }

  async function get(
    id: string,
    opts: KnowledgeBaseCallOptions = {}
  ): Promise<KnowledgeBase | null> {
    const { body } = await transport.request<KnowledgeBase | null>({
      path: `/admin/knowledge-bases/${encodePath(id)}`,
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  async function update(
    id: string,
    input: UpdateKnowledgeBaseInput,
    opts: KnowledgeBaseCallOptions = {}
  ): Promise<KnowledgeBase | null> {
    const { body } = await transport.request<KnowledgeBase | null>({
      path: `/admin/knowledge-bases/${encodePath(id)}`,
      method: "PATCH",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  async function remove(
    id: string,
    opts: KnowledgeBaseCallOptions = {}
  ): Promise<boolean> {
    const { body } = await transport.request<boolean>({
      path: `/admin/knowledge-bases/${encodePath(id)}`,
      method: "DELETE",
      retry: opts.retry,
    });
    return body;
  }

  function documentsList(kbId: string): Paginated<KnowledgeBaseDocument> {
    return paginate<KnowledgeBaseDocument>(async () => {
      const { body } = await transport.request<ListDocumentsPage>({
        path: `/admin/knowledge-bases/${encodePath(kbId)}/documents`,
        method: "GET",
      });
      return toSinglePage(body.documents);
    });
  }

  async function documentsGet(
    kbId: string,
    id: string,
    opts: KnowledgeBaseCallOptions = {}
  ): Promise<KnowledgeBaseDocument | null> {
    const { body } = await transport.request<KnowledgeBaseDocument | null>({
      path: `/admin/knowledge-bases/${encodePath(kbId)}/documents/${encodePath(id)}`,
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  function listChunks(
    kbId: string,
    id: string,
    params: ListChunksParams = {}
  ): Paginated<DocumentChunk> {
    return paginate<DocumentChunk>(
      async ({ limit, offset }) => {
        const page = Math.floor(offset / limit) + 1;
        const query = new URLSearchParams({
          page: String(page),
          limit: String(limit),
        });
        const { body } = await transport.request<ChunksPage>({
          // `kbId` is required for routing (controller is nested under
          // `admin/knowledge-bases/:kbId/documents`) but the downstream
          // service resolves the document/chunks by `id` alone — see types.ts.
          path: `/admin/knowledge-bases/${encodePath(kbId)}/documents/${encodePath(id)}/chunks?${query.toString()}`,
          method: "GET",
        });
        return toOffsetPage(body.chunks, body.total, offset);
      },
      { pageSize: params.pageSize, startOffset: params.startOffset }
    );
  }

  async function updateChunk(
    kbId: string,
    docId: string,
    chunkId: string,
    input: UpdateChunkInput,
    opts: KnowledgeBaseCallOptions = {}
  ): Promise<DocumentChunk> {
    const { body } = await transport.request<DocumentChunk>({
      path: `/admin/knowledge-bases/${encodePath(kbId)}/documents/${encodePath(docId)}/chunks/${encodePath(chunkId)}`,
      method: "PUT",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  async function upload(
    kbId: string,
    input: UploadDocumentInput,
    opts: KnowledgeBaseCallOptions = {}
  ): Promise<DocumentUploadResult> {
    const { body } = await transport.request<DocumentUploadResult>({
      path: `/admin/knowledge-bases/${encodePath(kbId)}/documents/upload`,
      method: "POST",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  async function uploadFile(
    kbId: string,
    input: UploadFileDocumentInput,
    opts: KnowledgeBaseCallOptions = {}
  ): Promise<DocumentUploadResult> {
    const { body } = await transport.request<DocumentUploadResult>({
      path: `/admin/knowledge-bases/${encodePath(kbId)}/documents/upload-file`,
      method: "POST",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  async function reingest(
    kbId: string,
    id: string,
    opts: KnowledgeBaseCallOptions = {}
  ): Promise<DocumentUploadResult> {
    const { body } = await transport.request<DocumentUploadResult>({
      path: `/admin/knowledge-bases/${encodePath(kbId)}/documents/${encodePath(id)}/reingest`,
      method: "POST",
      retry: opts.retry,
    });
    return body;
  }

  async function documentsRemove(
    kbId: string,
    id: string,
    opts: KnowledgeBaseCallOptions = {}
  ): Promise<boolean> {
    const { body } = await transport.request<boolean>({
      path: `/admin/knowledge-bases/${encodePath(kbId)}/documents/${encodePath(id)}`,
      method: "DELETE",
      retry: opts.retry,
    });
    return body;
  }

  return {
    create,
    list,
    get,
    update,
    remove,
    documents: {
      list: documentsList,
      get: documentsGet,
      listChunks,
      updateChunk,
      upload,
      uploadFile,
      reingest,
      remove: documentsRemove,
    },
  };
}
