export const STREAM_NAME = 'EVENTS';
export const STREAM_SUBJECTS = ['events.>'] as const;
export const CONSUMER_NAME = 'event-processor';
export const AUDIT_CONSUMER_NAME = 'audit-writer';
export const METRICS_CONSUMER_NAME = 'metrics-writer';
export const METRICS_SUBJECT = 'events.metrics';

export const SUBJECT_PREFIX = 'events';

export const RESULTS_STREAM_NAME = 'RESULTS';
export const RESULTS_STREAM_SUBJECTS = ['results.>'] as const;
export const RESULTS_SUBJECT_PREFIX = 'results';
export const WEBHOOK_CONSUMER_NAME = 'webhook-dispatcher';
export const WEBHOOK_DLQ_SUBJECT = 'dlq.webhook';
export const WEBHOOK_MAX_RETRIES = 3;
export const WEBHOOK_RETRY_DELAYS = [1_000, 5_000, 30_000] as const;

export const DLQ_STREAM_NAME = 'DLQ';
export const DLQ_STREAM_SUBJECTS = ['dlq.>'] as const;
export const DLQ_STREAM_MAX_BYTES = 64 * 1024 * 1024;

export const RESULT_KEY_PREFIX = 'result:';
export const PENDING_KEY_PREFIX = 'pending:';
export const CALLBACK_KEY_PREFIX = 'callback:';

export const RESULT_TTL = 3600;
export const PENDING_TTL = 3600;
export const CALLBACK_TTL = 3600;
export const RESULT_CACHE_MAX = 1024;

export const STREAM_MAX_AGE_NS = 7 * 24 * 60 * 60 * 1_000_000_000;
export const STREAM_MAX_BYTES = 512 * 1024 * 1024;
export const RESULTS_STREAM_MAX_BYTES = 256 * 1024 * 1024;
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

export const WORKFLOW_ORCHESTRATOR_TASK_QUEUE = 'workflow-orchestrator';
export const WORKFLOW_HTTP_TASK_QUEUE = 'workflow-http';
export const WORKFLOW_DEFAULT_TIMEOUT_MS = 60_000;

export const DEFAULT_ADAPTER_SERVICE_URL =
  "http://adapter-service.platform-services.svc.cluster.local";

export const GATEWAY_AUDIT_STREAM_NAME = 'GATEWAY_AUDIT';
export const GATEWAY_AUDIT_STREAM_SUBJECTS = ['audit.gateway.>'] as const;
export const GATEWAY_AUDIT_SUBJECT = 'audit.gateway.request';
export const GATEWAY_AUDIT_CONSUMER_NAME = 'gateway-audit-writer';
export const GATEWAY_AUDIT_STREAM_MAX_BYTES = 128 * 1024 * 1024;

export const YOIZENCLAW_PRODUCER = "yoizenclaw-admin-service";
export const YOIZENCLAW_DOMAIN = "automation";
export const YOIZENCLAW_CHANNEL = "yoizenclaw";
export const YOIZENCLAW_PROVIDER = "internal";
export const YOIZENCLAW_ACCOUNT_ID = "yoizenclaw-admin";

export const YOIZENCLAW_SUBJECT_PREFIX =
  "evt.{tenant}.yoizenclaw-admin-service.automation.yoizenclaw.internal";

export const YOIZENCLAW_CONFIG_SYNC =
  `${YOIZENCLAW_SUBJECT_PREFIX}.config_sync.v1`;
export const YOIZENCLAW_JOBS_SYNC =
  `${YOIZENCLAW_SUBJECT_PREFIX}.jobs_sync.v1`;
export const YOIZENCLAW_JOB_TRIGGER =
  `${YOIZENCLAW_SUBJECT_PREFIX}.job_trigger.v1`;
export const YOIZENCLAW_CHAT_RESPOND =
  `${YOIZENCLAW_SUBJECT_PREFIX}.chat_respond.v1`;
export const YOIZENCLAW_ONLINE =
  `${YOIZENCLAW_SUBJECT_PREFIX}.online.v1`;
export const YOIZENCLAW_AGENT_OUTBOUND =
  `${YOIZENCLAW_SUBJECT_PREFIX}.agent_outbound.v1`;
export const YOIZENCLAW_EXECUTION_STATUS =
  `${YOIZENCLAW_SUBJECT_PREFIX}.execution_status.v1`;
export const YOIZENCLAW_AGENT_PUBLISHED =
  `${YOIZENCLAW_SUBJECT_PREFIX}.agent_published.v1`;
export const YOIZENCLAW_AGENT_UNPUBLISHED =
  `${YOIZENCLAW_SUBJECT_PREFIX}.agent_unpublished.v1`;
export const YOIZENCLAW_CREDENTIAL_ROTATED =
  `${YOIZENCLAW_SUBJECT_PREFIX}.credential_rotated.v1`;
export const YOIZENCLAW_CREDENTIAL_SYNC =
  `${YOIZENCLAW_SUBJECT_PREFIX}.credential_sync.v1`;
export const YOIZENCLAW_CREDENTIAL_SYNC_COMPLETED =
  `${YOIZENCLAW_SUBJECT_PREFIX}.credential_sync_completed.v1`;
export const YOIZENCLAW_EVENT =
  `${YOIZENCLAW_SUBJECT_PREFIX}.event.v1`;

export function buildYoizenClawSubject(template: string, tenantId: string): string {
  return template.replaceAll("{tenant}", tenantId);
}
