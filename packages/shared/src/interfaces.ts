export interface EventEnvelope {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  metadata?: EventMetadata;
  callbackUrl?: string;
}

export interface EventMetadata {
  correlationId?: string;
  source?: string;
  receivedAt?: number;
  tenantId?: string;
}

export interface EventResult {
  processed: boolean;
  data?: unknown;
}

export interface ProcessedEvent {
  eventId: string;
  type: string;
  processed: boolean;
  timestamp: number;
  data?: unknown;
  metadata?: EventMetadata;
}

export interface CompletionEvent {
  eventId: string;
  type: string;
  result: ProcessedEvent;
  callbackUrl?: string;
}

export interface MetricsPayload {
  source: string;
  name: string;
  value: number;
  tags?: Record<string, string>;
  timestamp?: number;
}
