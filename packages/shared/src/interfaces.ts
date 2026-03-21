export interface EventEnvelope {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  metadata?: EventMetadata;
  callbackUrl?: string;
  adapterId?: string;
  enrichAdapter?: { adapterId: string; endpointId: string };
  forwardAdapter?: { adapterId: string; endpointId: string };
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
  adapterId?: string;
}

export interface MetricsPayload {
  source: string;
  name: string;
  value: number;
  tags?: Record<string, string>;
  timestamp?: number;
}
