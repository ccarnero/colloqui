export type {
  EventTransport,
  EventData,
  EventEnvelope,
  TokenResponse,
  WorkflowDefinition,
  WorkflowAction,
  EndpointCallAction,
  JsFunctionAction,
  ServiceBusCallAction,
  BranchAction,
  HttpEndpointRequest,
  HttpServiceRequest,
  AgentChatRequest,
  HttpExecutionResult,
  EndpointCallArgs,
  JsFunctionArgs,
  ServiceBusCallArgs,
  WorkflowExecutionContext,
} from '@yoizen/shared';

// ---------------------------------------------------------------------------
// SDK configuration
// ---------------------------------------------------------------------------

export interface YoizenClientOptions {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  tenant: string;
  /** Max retries on 5xx / network errors (default 0 = no retry) */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default 500) */
  retryBaseDelayMs?: number;
  /** Custom fetch implementation (defaults to globalThis.fetch) */
  fetch?: typeof globalThis.fetch;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
}

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

export interface StartWorkflowParams {
  name: string;
  application: string;
  request: Record<string, unknown>;
  actions: import('@yoizen/shared').WorkflowAction[];
}

export interface StartWorkflowResult {
  workflowId: string;
  runId: string;
}

export interface WorkflowStatusResult {
  workflowId: string;
  status: string;
  result?: unknown;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export interface RegisterServiceParams {
  name: string;
  image: string;
  port?: number;
  minScale?: number;
  maxScale?: number;
  concurrencyTarget?: number;
  envVars?: Record<string, string>;
}

export interface UpdateServiceParams {
  image?: string;
  port?: number;
  minScale?: number;
  maxScale?: number;
  concurrencyTarget?: number;
  envVars?: Record<string, string>;
}

export interface RegisteredService {
  id: string;
  tenantId: string;
  name: string;
  image: string;
  port: number;
  minScale: number;
  maxScale: number;
  concurrencyTarget: number;
  envVars: Record<string, string>;
  status: string;
  knativeName: string | null;
  namespace: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceDetail extends RegisteredService {
  knativeStatus?: Record<string, unknown>;
}

export interface RevisionInfo {
  name: string;
  ready: boolean;
  createdAt: string;
  image: string;
}

export interface CreateRouteParams {
  pathPrefix: string;
  methods?: string[];
  isPublic?: boolean;
  stripPrefix?: boolean;
}

export interface ServiceRoute {
  id: string;
  serviceId: string;
  pathPrefix: string;
  methods: string[];
  isPublic: boolean;
  stripPrefix: boolean;
  createdAt: string;
}

export interface StartCanaryParams {
  image: string;
  percent: number;
}

export interface UpdateCanaryParams {
  percent: number;
}

export interface CanaryStatus {
  id: string;
  serviceId: string;
  stableRevision: string;
  canaryRevision: string;
  canaryPercent: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

export interface CacheSetOptions {
  ttl?: number;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditQuery {
  type?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface AuditEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  subject: string;
  created_at: string;
}

export interface AuditQueryResult {
  events: AuditEvent[];
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class YoizenApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    public readonly endpoint: string,
  ) {
    super(`Yoizen API error ${status} on ${endpoint}`);
    this.name = 'YoizenApiError';
  }
}
