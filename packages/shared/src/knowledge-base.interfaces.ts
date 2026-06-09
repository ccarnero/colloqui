// ── Knowledge base types ───────────────────────────────────────────

export interface IKnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  project: string | null;
  category: string | null;
  icon: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type DocumentContentType = "text" | "markdown" | "pdf" | "csv" | "html";

export type DocumentStatus = "pending" | "processing" | "ready" | "failed";

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

export interface IDocumentChunk {
  id: string;
  document_id: string;
  knowledge_base_id: string;
  chunk_index: number;
  content: string;
  created_at: string;
}

export interface IKbListResponse {
  knowledge_bases: IKnowledgeBase[];
  total: number;
}

export interface IDocumentListResponse {
  documents: IDocument[];
  total: number;
}
