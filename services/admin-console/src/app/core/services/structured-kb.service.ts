import { inject, Injectable } from "@angular/core";
import { HttpClient, HttpHeaders } from "@angular/common/http";
import type { Observable } from "rxjs";
import { environment } from "../../../environments/environment";
import { AUTH_CONTEXT } from "@yoizen/angular-shared";

// ── Types ───────────────────────────────────────────────────────────

export interface SKBContainerColumn {
  name: string;
  type: string;
  description?: string;
  filterable: boolean;
}

export interface SKBContainerSchema {
  columns: SKBContainerColumn[];
}

export interface SKBContainer {
  id: string;
  name: string;
  description?: string;
  status: "pending" | "processing" | "ready" | "failed";
  file_count: number;
  schema?: SKBContainerSchema;
  created_at: string;
  updated_at: string;
}

export interface SKBContainerListResponse {
  containers: SKBContainer[];
  total: number;
}

export interface SKBFile {
  id: string;
  name: string;
  status: "pending" | "processing" | "ready" | "failed";
  row_count: number;
  created_at: string;
}

export interface SKBFileListResponse {
  files: SKBFile[];
  total: number;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  sql: string;
  duration_ms: number;
}

export interface QueryHistoryRecord {
  id: string;
  query: string;
  sql: string;
  results_count: number;
  duration_ms: number;
  created_at: string;
}

export interface QueryHistoryResponse {
  queries: QueryHistoryRecord[];
  total: number;
}

export interface QueryOptions {
  limit?: number;
  offset?: number;
}

// ── Service ─────────────────────────────────────────────────────────

@Injectable({ providedIn: "root" })
export class StructuredKbService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/admin/structured-kb`;

  /** Optional auth context — resolved when the app provides it. */
  private readonly auth = inject(AUTH_CONTEXT, { optional: true });

  // ── Containers ──────────────────────────────────────────────────

  getContainers(): Observable<SKBContainerListResponse> {
    return this.http.get<SKBContainerListResponse>(
      `${this.base}/containers`,
      this.requestOptions(),
    );
  }

  getContainer(id: string): Observable<SKBContainer> {
    return this.http.get<SKBContainer>(
      `${this.base}/containers/${id}`,
      this.requestOptions(),
    );
  }

  createContainer(data: {
    name: string;
    description?: string;
  }): Observable<SKBContainer> {
    return this.http.post<SKBContainer>(
      `${this.base}/containers`,
      data,
      this.requestOptions(),
    );
  }

  deleteContainer(id: string): Observable<void> {
    return this.http.delete<void>(
      `${this.base}/containers/${id}`,
      this.requestOptions(),
    );
  }

  // ── Files ───────────────────────────────────────────────────────

  uploadFile(containerId: string, file: File): Observable<SKBFile> {
    const formData = new FormData();
    formData.append("file", file);
    return this.http.post<SKBFile>(
      `${this.base}/containers/${containerId}/files`,
      formData,
      this.requestOptions(),
    );
  }

  getFiles(containerId: string): Observable<SKBFileListResponse> {
    return this.http.get<SKBFileListResponse>(
      `${this.base}/containers/${containerId}/files`,
      this.requestOptions(),
    );
  }

  // ── Query ───────────────────────────────────────────────────────

  query(
    containerId: string,
    nlQuery: string,
    options?: QueryOptions,
  ): Observable<QueryResult> {
    const body: Record<string, unknown> = { nl_query: nlQuery };
    if (options?.limit != null) body["limit"] = options.limit;
    if (options?.offset != null) body["offset"] = options.offset;
    return this.http.post<QueryResult>(
      `${this.base}/containers/${containerId}/query`,
      body,
      this.requestOptions(),
    );
  }

  getQueryHistory(
    containerId: string,
  ): Observable<QueryHistoryResponse> {
    return this.http.get<QueryHistoryResponse>(
      `${this.base}/containers/${containerId}/queries`,
      this.requestOptions(),
    );
  }

  // ── Helpers ─────────────────────────────────────────────────────

  private requestOptions(): { headers: HttpHeaders } {
    const token = this.auth?.token();
    const tenantId = this.auth?.tenantId();
    let headers = new HttpHeaders();
    if (token) headers = headers.set("Authorization", `Bearer ${token}`);
    if (tenantId) headers = headers.set("X-Tenant-Id", tenantId);
    return { headers };
  }
}
