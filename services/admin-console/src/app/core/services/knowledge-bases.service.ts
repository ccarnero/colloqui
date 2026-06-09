import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Observable } from "rxjs";
import { environment } from "../../../environments/environment";

// ── Types (mirrors @yoizen/shared knowledge-base.interfaces) ────────

export type DocumentContentType = "text" | "markdown" | "pdf" | "csv" | "html";
export type DocumentStatus = "pending" | "processing" | "ready" | "failed";

export interface IKnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  project: string | null;
  category: string | null;
  icon: string;
  ingestion_config: Record<string, unknown> | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface IDocument {
  id: string;
  knowledge_base_id: string;
  original_filename: string;
  mime_type: string;
  content_type: DocumentContentType;
  content_text: string | null;
  file_size: number;
  chunk_count: number;
  status: DocumentStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface IKbListResponse {
  knowledge_bases: IKnowledgeBase[];
  total: number;
}

export interface IDocumentListResponse {
  documents: IDocument[];
  total: number;
}

export interface ICreateKnowledgeBasePayload {
  name: string;
  description?: string;
  project?: string;
  category?: string;
  ingestion_config?: Record<string, unknown>;
}

export type IUpdateKnowledgeBasePayload = Partial<ICreateKnowledgeBasePayload>;

export interface IDocumentUploadPayload {
  original_filename: string;
  mime_type: string;
  content_type: DocumentContentType;
  content_text: string;
}

export interface IDocumentFileUploadPayload {
  filename: string;
  file_base64: string;
  content_type: "auto" | DocumentContentType;
}

export interface IChunk {
  id: string;
  chunk_index: number;
  content: string;
  char_count: number;
  is_edited: boolean;
  edited_at: string | null;
}

export interface IChunkListResponse {
  chunks: IChunk[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

// ── Service ─────────────────────────────────────────────────────────

@Injectable({ providedIn: "root" })
export class KnowledgeBasesService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/admin/knowledge-bases`;

  findAll(): Observable<IKbListResponse> {
    return this.http.get<IKbListResponse>(this.base);
  }

  findById(id: string): Observable<IKnowledgeBase> {
    return this.http.get<IKnowledgeBase>(`${this.base}/${id}`);
  }

  create(payload: ICreateKnowledgeBasePayload): Observable<IKnowledgeBase> {
    return this.http.post<IKnowledgeBase>(this.base, payload);
  }

  update(
    id: string,
    payload: IUpdateKnowledgeBasePayload,
  ): Observable<IKnowledgeBase> {
    return this.http.patch<IKnowledgeBase>(`${this.base}/${id}`, payload);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  // ── Documents ───────────────────────────────────────────────────

  findDocuments(kbId: string): Observable<IDocumentListResponse> {
    return this.http.get<IDocumentListResponse>(
      `${this.base}/${kbId}/documents`,
    );
  }

  uploadDocument(
    kbId: string,
    payload: IDocumentUploadPayload,
  ): Observable<IDocument> {
    return this.http.post<IDocument>(
      `${this.base}/${kbId}/documents/upload`,
      payload,
    );
  }

  uploadFile(
    kbId: string,
    payload: IDocumentFileUploadPayload,
  ): Observable<IDocument> {
    return this.http.post<IDocument>(
      `${this.base}/${kbId}/documents/upload-file`,
      payload,
    );
  }

  reingestDocument(kbId: string, docId: string): Observable<{ documentId: string; status: string }> {
    return this.http.post<{ documentId: string; status: string }>(
      `${this.base}/${kbId}/documents/${docId}/reingest`,
      {},
    );
  }

  deleteDocument(kbId: string, docId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.base}/${kbId}/documents/${docId}`,
    );
  }

  findDocumentChunks(
    kbId: string,
    docId: string,
    page: number = 1,
    limit: number = 50,
  ): Observable<IChunkListResponse> {
    return this.http.get<IChunkListResponse>(
      `${this.base}/${kbId}/documents/${docId}/chunks`,
      { params: { page: String(page), limit: String(limit) } },
    );
  }

  updateChunk(
    kbId: string,
    docId: string,
    chunkId: string,
    content: string,
  ): Observable<IChunk> {
    return this.http.put<IChunk>(
      `${this.base}/${kbId}/documents/${docId}/chunks/${chunkId}`,
      { content },
    );
  }
}
