export type SKBColumnType = "text" | "categorical" | "numeric" | "date" | "boolean" | "unknown";

export type SKBContainerStatus = "pending" | "processing" | "ready" | "failed";
export type SKBFileStatus = "pending" | "processing" | "completed" | "failed";

export interface ProviderConfig {
  provider: string;
  apiKey: string;
  apiBaseUrl?: string;
}

export class SKBFileIngestionPayload {
  containerId!: string;
  fileId!: string;
  tenantId!: string;
  fileUrl!: string;
  categories!: string[];
  sheetName!: string | null;
}

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

export interface FileRow {
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

export interface ColumnAnalysis {
  name: string;
  type: SKBColumnType;
  description: string;
  is_filterable: boolean;
  sample_values: string[];
}

export interface SchemaAnalysisResult {
  columns: ColumnAnalysis[];
  rowCount: number;
  table_description: string;
  analyzed_at: string;
}
