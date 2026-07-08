import type { Paginated } from "../../core/pagination.js";
import { paginate, toSinglePage } from "../../core/pagination.js";
import type { RetryConfig } from "../../core/retry.js";
import type { Transport } from "../../core/transport.js";
import type {
  CreateSKBContainerInput,
  QuerySKBContainerInput,
  QuerySKBContainerResult,
  SKBContainer,
  UpdateSKBContainerInput,
  UploadSKBFileInput,
  UploadSKBFileResult,
} from "./types.js";

export interface StructuredKbClientDeps {
  transport: Transport;
}

export interface StructuredKbCallOptions {
  /** Per-call retry override; `false` disables retries for this call only. */
  retry?: RetryConfig | false;
}

export interface StructuredKbContainersClient {
  /** `POST /admin/structured-kb/containers`. */
  create(
    input: CreateSKBContainerInput,
    opts?: StructuredKbCallOptions
  ): Promise<SKBContainer>;
  /** `GET /admin/structured-kb/containers` — bare array, degraded to a single page. */
  list(): Paginated<SKBContainer>;
  /** `GET /admin/structured-kb/containers/:id`. */
  get(id: string, opts?: StructuredKbCallOptions): Promise<SKBContainer>;
  /** `PATCH /admin/structured-kb/containers/:id`. */
  update(
    id: string,
    input: UpdateSKBContainerInput,
    opts?: StructuredKbCallOptions
  ): Promise<SKBContainer>;
  /**
   * `DELETE /admin/structured-kb/containers/:id`; resolves with no value.
   * The gateway returns HTTP 200 with an empty-object body for this route
   * (not a 204) — see `types.ts`.
   */
  remove(id: string, opts?: StructuredKbCallOptions): Promise<void>;
  /**
   * `POST /admin/structured-kb/containers/:id/query` — translates a
   * natural-language `query` into SQL via an LLM and runs it against the
   * container's schema (rate-limited downstream: 30 req/min per tenant).
   * As of 2026-07-05 this gateway route 404s on the dev cluster (fix not
   * yet deployed/hot-reloaded) — see `types.ts`.
   */
  query(
    id: string,
    input: QuerySKBContainerInput,
    opts?: StructuredKbCallOptions
  ): Promise<QuerySKBContainerResult>;
  /**
   * `POST /admin/structured-kb/containers/:id/files` — uploads a structured
   * file (CSV/XLSX/XLS) for async ingestion; resolves once the file row is
   * created and the ingestion event is published (`202 Accepted`), not once
   * ingestion completes. See `types.ts`.
   */
  uploadFile(
    containerId: string,
    input: UploadSKBFileInput,
    opts?: StructuredKbCallOptions
  ): Promise<UploadSKBFileResult>;
}

export interface StructuredKbClient {
  containers: StructuredKbContainersClient;
}

/**
 * Creates the `structuredKb` namespace client. Follows the `workflows`
 * reference implementation (GROWTH-PLAN.md Phase 2) — see sdk/README.md
 * "Resource clients".
 */
export function createStructuredKbClient({
  transport,
}: StructuredKbClientDeps): StructuredKbClient {
  function encodePath(id: string): string {
    return encodeURIComponent(id);
  }

  async function create(
    input: CreateSKBContainerInput,
    opts: StructuredKbCallOptions = {}
  ): Promise<SKBContainer> {
    const { body } = await transport.request<SKBContainer>({
      path: "/admin/structured-kb/containers",
      method: "POST",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  function list(): Paginated<SKBContainer> {
    return paginate<SKBContainer>(async () => {
      const { body } = await transport.request<SKBContainer[]>({
        path: "/admin/structured-kb/containers",
        method: "GET",
      });
      return toSinglePage(body);
    });
  }

  async function get(
    id: string,
    opts: StructuredKbCallOptions = {}
  ): Promise<SKBContainer> {
    const { body } = await transport.request<SKBContainer>({
      path: `/admin/structured-kb/containers/${encodePath(id)}`,
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  async function update(
    id: string,
    input: UpdateSKBContainerInput,
    opts: StructuredKbCallOptions = {}
  ): Promise<SKBContainer> {
    const { body } = await transport.request<SKBContainer>({
      path: `/admin/structured-kb/containers/${encodePath(id)}`,
      method: "PATCH",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  async function remove(
    id: string,
    opts: StructuredKbCallOptions = {}
  ): Promise<void> {
    await transport.request<Record<string, never>>({
      path: `/admin/structured-kb/containers/${encodePath(id)}`,
      method: "DELETE",
      retry: opts.retry,
    });
  }

  async function query(
    id: string,
    input: QuerySKBContainerInput,
    opts: StructuredKbCallOptions = {}
  ): Promise<QuerySKBContainerResult> {
    const { body } = await transport.request<QuerySKBContainerResult>({
      path: `/admin/structured-kb/containers/${encodePath(id)}/query`,
      method: "POST",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  async function uploadFile(
    containerId: string,
    input: UploadSKBFileInput,
    opts: StructuredKbCallOptions = {}
  ): Promise<UploadSKBFileResult> {
    const { body } = await transport.request<UploadSKBFileResult>({
      path: `/admin/structured-kb/containers/${encodePath(containerId)}/files`,
      method: "POST",
      body: {
        filename: input.filename,
        file_base64: input.fileBase64,
        categories: input.categories,
        sheet_name: input.sheetName,
      },
      retry: opts.retry,
    });
    return body;
  }

  return {
    containers: { create, list, get, update, remove, query, uploadFile },
  };
}
