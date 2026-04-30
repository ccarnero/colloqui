export type {
  EventTransport,
  EventData,
  EventEnvelope,
  EventResult,
  ProcessedEvent,
  CompletionEvent,
  MetricsPayload,
  TokenResponse,
  WorkflowDefinition,
  WorkflowAction,
  EndpointCallAction,
  JsFunctionAction,
  ServiceBusCallAction,
  BranchAction,
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
// Events
// ---------------------------------------------------------------------------

export interface PublishEventParams {
  type: string;
  payload: Record<string, unknown>;
  callbackUrl?: string;
}

export interface PublishEventResult {
  id: string;
  status: string;
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
// Schedules
// ---------------------------------------------------------------------------

export type ScheduleType = 'cron' | 'interval' | 'one-time';
export type ExecMode = 'js-inline' | 'js-k8s' | 'docker';

export interface ScheduleConfig {
  script?: string;
  image?: string;
  env?: Record<string, string>;
  timeout?: number;
  resources?: { cpu?: string; memory?: string };
  [key: string]: unknown;
}

export interface CreateScheduleParams {
  name: string;
  description?: string;
  type: ScheduleType;
  expression: string;
  exec_mode: ExecMode;
  config: ScheduleConfig;
  enabled?: boolean;
}

export interface UpdateScheduleParams {
  name?: string;
  description?: string;
  type?: ScheduleType;
  expression?: string;
  exec_mode?: ExecMode;
  config?: ScheduleConfig;
  enabled?: boolean;
}

export interface Schedule {
  id: string;
  name: string;
  description: string;
  type: ScheduleType;
  expression: string;
  exec_mode: ExecMode;
  config: Record<string, unknown>;
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TriggerScheduleResult {
  triggered: boolean;
  schedule_id: string;
}

export interface ExecutionLog {
  id: string;
  schedule_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  output: unknown;
  error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ScheduleQuery {
  enabled?: boolean;
  type?: ScheduleType;
  limit?: number;
  offset?: number;
}

export interface ExecutionQuery {
  status?: string;
  limit?: number;
  offset?: number;
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
