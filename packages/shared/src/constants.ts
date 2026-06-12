export const DLQ_STREAM_NAME = 'DLQ';
/**
 * Subjects owned by the global `DLQ` stream.
 *
 * callback delivery exhausts its retries (`dlq.webhook`). The
 * `dlq.<tenant>.>` namespace is reserved for per-tenant DLQ streams
 * (`DLQ-<tenant>`) provisioned by `ensureTenantDlqStream`, so the two
 * designs coexist without JetStream subject overlap.
 */
export const DLQ_STREAM_SUBJECTS = ['dlq.webhook'] as const;
export const DLQ_STREAM_MAX_BYTES = 64 * 1024 * 1024;

export const RESULT_KEY_PREFIX = 'result:';
export const PENDING_KEY_PREFIX = 'pending:';
export const CALLBACK_KEY_PREFIX = 'callback:';

export const RESULT_TTL = 3600;
export const PENDING_TTL = 3600;
export const CALLBACK_TTL = 3600;
export const RESULT_CACHE_MAX = 1024;

export const STREAM_MAX_AGE_NS = 7 * 24 * 60 * 60 * 1_000_000_000;
export const MAX_DELIVER = 5;

export const TENANT_HEADER = 'x-yoizen-tenant';

export const SCHEDULER_DEFAULT_TIMEOUT_MS = 30_000;
export const SCHEDULER_K8S_DEFAULT_TIMEOUT_S = 300;
export const SCHEDULER_TICK_INTERVAL_MS = 5_000;
export const SCHEDULER_MAX_EXECUTION_LOG_ROWS = 500;

export const REGISTRY_KNATIVE_GROUP = 'serving.knative.dev';
export const REGISTRY_KNATIVE_VERSION = 'v1';
export const REGISTRY_KNATIVE_SERVICES_PLURAL = 'services';
export const REGISTRY_KNATIVE_REVISIONS_PLURAL = 'revisions';

/** Default container port when registering a Knative service without explicit port. */
export const REGISTRY_DEFAULT_SERVICE_PORT = 3000;

/**
 * Producer/domain tokens for platform-level events (DOCS/es/arquitectura/02 §3).
 * Used by registry-service when emitting service lifecycle events that
 * other services (adapter-service) materialize as internal adapters.
 */
export const REGISTRY_PRODUCER = 'registry-service';
export const REGISTRY_DOMAIN = 'platform';
/**
 * Placeholder token for the 5th/6th positions (channel/provider) when
 * the event is domain-agnostic (not tied to a messaging channel).
 * Keeps the canonical 8-token subject shape.
 */
export const PLATFORM_NON_CHANNEL_TOKEN = 'system';

/** Internal adapter marker: adapters created by the registry-sync consumer. */
export const ADAPTER_MANAGED_BY_REGISTRY = 'registry-service';

export const WORKFLOW_ORCHESTRATOR_TASK_QUEUE = 'workflow-orchestrator';
export const CONNECTOR_RUNTIME_TASK_QUEUE = 'connector-runtime';
/**
 * Default `workflowExecutionTimeout` for `runWorkflow` starts. This is
 * the wall-clock budget from `workflow.start` to terminal status —
 * INCLUDING time spent in the schedule-to-start queue waiting for a
 * worker to pick the workflow task up.
 *
 * Stress-test learning: a short ceiling (was 60s) means that under
 * backlog the workflow times out before any worker even sees it,
 * cascading the whole pipeline into `Timed Out` status.
 *
 * 10 minutes accommodates queue waits during bursts and the longest
 * agent activity (`agentCall` start_to_close 5m) with retries.
 */
export const WORKFLOW_DEFAULT_TIMEOUT_MS = 600_000;
/**
 * Default `workflowTaskTimeout` — how long a single workflow task can
 * take to be answered by a worker before Temporal retries it. Default
 * (10s) is fine for most workflows; we set it explicitly to avoid
 * surprises when the SDK changes defaults across versions.
 */
export const WORKFLOW_TASK_TIMEOUT_MS = 30_000;

export const GATEWAY_AUDIT_STREAM_NAME = 'GATEWAY_AUDIT';
export const GATEWAY_AUDIT_STREAM_SUBJECTS = ['audit.gateway.>'] as const;
export const GATEWAY_AUDIT_SUBJECT = 'audit.gateway.request';
export const GATEWAY_AUDIT_CONSUMER_NAME = 'gateway-audit-writer';
export const GATEWAY_AUDIT_STREAM_MAX_BYTES = 128 * 1024 * 1024;

export const PLATFORM_PRODUCER = "agent-admin-service";
export const PLATFORM_DOMAIN = "automation";
export const PLATFORM_CHANNEL = "platform";
export const PLATFORM_PROVIDER = "internal";
export const PLATFORM_ACCOUNT_ID = "platform-admin";

export const PLATFORM_SUBJECT_PREFIX =
  "evt.{tenant}.agent-admin-service.automation.platform.internal";

export const PLATFORM_CONFIG_SYNC =
  `${PLATFORM_SUBJECT_PREFIX}.config_sync.v1`;
export const PLATFORM_JOBS_SYNC =
  `${PLATFORM_SUBJECT_PREFIX}.jobs_sync.v1`;
export const PLATFORM_JOB_TRIGGER =
  `${PLATFORM_SUBJECT_PREFIX}.job_trigger.v1`;
export const PLATFORM_CHAT_RESPOND =
  `${PLATFORM_SUBJECT_PREFIX}.chat_respond.v1`;
export const PLATFORM_ONLINE =
  `${PLATFORM_SUBJECT_PREFIX}.online.v1`;
export const PLATFORM_AGENT_OUTBOUND =
  `${PLATFORM_SUBJECT_PREFIX}.agent_outbound.v1`;
export const PLATFORM_EXECUTION_STATUS =
  `${PLATFORM_SUBJECT_PREFIX}.execution_status.v1`;
export const PLATFORM_AGENT_PUBLISHED =
  `${PLATFORM_SUBJECT_PREFIX}.agent_published.v1`;
export const PLATFORM_AGENT_UNPUBLISHED =
  `${PLATFORM_SUBJECT_PREFIX}.agent_unpublished.v1`;
export const PLATFORM_EVENT =
  `${PLATFORM_SUBJECT_PREFIX}.event.v1`;
export const PLATFORM_DOCUMENT_INGESTION =
  `${PLATFORM_SUBJECT_PREFIX}.document_ingestion.v1`;
export const PLATFORM_SKB_FILE_INGESTION =
  `${PLATFORM_SUBJECT_PREFIX}.skb_file_ingestion.v1`;
export const AI_AGENT_GATEWAY_PRODUCER = "ai-agent-gateway";
export const AI_AGENT_GATEWAY_SUBJECT_PREFIX =
  "evt.{tenant}.ai-agent-gateway.automation.platform.internal";
export const PLATFORM_EXECUTION_REQUESTED =
  `${AI_AGENT_GATEWAY_SUBJECT_PREFIX}.execution_requested.v1`;
export const PLATFORM_EXECUTION_STARTED =
  `${AI_AGENT_GATEWAY_SUBJECT_PREFIX}.execution_started.v1`;
export const PLATFORM_EXECUTION_COMPLETED =
  `${AI_AGENT_GATEWAY_SUBJECT_PREFIX}.execution_completed.v1`;
export const PLATFORM_EXECUTION_FAILED =
  `${AI_AGENT_GATEWAY_SUBJECT_PREFIX}.execution_failed.v1`;

export const SCHEDULER_SUBJECT_PREFIX = "evt.{tenant}.agent-scheduler-service.automation.platform.internal";
export const PLATFORM_SCHEDULER_HEARTBEAT = `${SCHEDULER_SUBJECT_PREFIX}.heartbeat.v1`;

export function buildPlatformSubject(template: string, tenantId: string): string {
  return template.replaceAll("{tenant}", tenantId);
}
