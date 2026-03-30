// Temporary module for @yoizen/shared
// These are used until the workspace packages are properly built

export const TENANT_HEADER = 'x-yoizen-tenant';

// NATS Constants
export const STREAM_NAME = 'EVENTS';
export const STREAM_SUBJECTS = ['events.>'];
export const SUBJECT_PREFIX = 'events.';
export const STREAM_MAX_AGE_NS = 604800000000000; // 7 days in nanoseconds
export const STREAM_MAX_BYTES = 536870912; // 512 MB

export interface EventMetadata {
  receivedAt: number;
  source: string;
  subject?: string;
  tenantId?: string;
}

export interface EventEnvelope {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  metadata?: EventMetadata;
  callbackUrl?: string;
  adapterId?: string;
  enrichAdapter?: string;
  forwardAdapter?: string;
}
