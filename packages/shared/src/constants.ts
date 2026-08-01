export const DLQ_STREAM_NAME = "DLQ";
/**
 * Subjects owned by the global `DLQ` stream.
 *
 * callback delivery exhausts its retries (`dlq.webhook`). The
 * `dlq.<tenant>.>` namespace is reserved for per-tenant DLQ streams
 * (`DLQ-<tenant>`) provisioned by `ensureTenantDlqStream`, so the two
 * designs coexist without JetStream subject overlap.
 */
export const DLQ_STREAM_SUBJECTS = ["dlq.webhook"] as const;
export const DLQ_STREAM_MAX_BYTES = 64 * 1024 * 1024;

export const RESULT_KEY_PREFIX = "result:";
export const PENDING_KEY_PREFIX = "pending:";
export const CALLBACK_KEY_PREFIX = "callback:";

export const RESULT_TTL = 3600;
export const PENDING_TTL = 3600;
export const CALLBACK_TTL = 3600;
export const RESULT_CACHE_MAX = 1024;

export const STREAM_MAX_AGE_NS = 7 * 24 * 60 * 60 * 1_000_000_000;
export const MAX_DELIVER = 5;

export const TENANT_HEADER = "x-yoizen-tenant";

export const SCHEDULER_DEFAULT_TIMEOUT_MS = 30_000;
export const SCHEDULER_K8S_DEFAULT_TIMEOUT_S = 300;
export const SCHEDULER_TICK_INTERVAL_MS = 5_000;
export const SCHEDULER_MAX_EXECUTION_LOG_ROWS = 500;

export const REGISTRY_KNATIVE_GROUP = "serving.knative.dev";
export const REGISTRY_KNATIVE_VERSION = "v1";
export const REGISTRY_KNATIVE_SERVICES_PLURAL = "services";
export const REGISTRY_KNATIVE_REVISIONS_PLURAL = "revisions";

/** Default container port when registering a Knative service without explicit port. */
export const REGISTRY_DEFAULT_SERVICE_PORT = 3000;

/**
 * Producer/domain tokens for platform-level events (DOCS/messaging/envelope.md §3).
 * Used by registry-service when emitting service lifecycle events that
 * other services (adapter-service) materialize as internal adapters.
 */
export const REGISTRY_PRODUCER = "registry-service";
export const REGISTRY_DOMAIN = "platform";
/**
 * Placeholder token for the 5th/6th positions (channel/provider) when
 * the event is domain-agnostic (not tied to a messaging channel).
 * Keeps the canonical 8-token subject shape.
 */
export const PLATFORM_NON_CHANNEL_TOKEN = "system";

/** Internal adapter marker: adapters created by the registry-sync consumer. */
export const ADAPTER_MANAGED_BY_REGISTRY = "registry-service";

export const WORKFLOW_ORCHESTRATOR_TASK_QUEUE = "workflow-orchestrator";
export const CONNECTOR_RUNTIME_TASK_QUEUE = "connector-runtime";
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

export const GATEWAY_AUDIT_STREAM_NAME = "GATEWAY_AUDIT";
export const GATEWAY_AUDIT_STREAM_SUBJECTS = ["audit.gateway.>"] as const;
export const GATEWAY_AUDIT_SUBJECT = "audit.gateway.request";
export const GATEWAY_AUDIT_CONSUMER_NAME = "gateway-audit-writer";
export const GATEWAY_AUDIT_STREAM_MAX_BYTES = 128 * 1024 * 1024;

/**
 * agent-admin-service's own identity and subject family.
 *
 * Renamed from `PLATFORM_*` on 2026-07-31 (envelope-drift post-loop item 2):
 * the old names read as platform-generic but their VALUES name one specific
 * service, and that mismatch caused two real bugs — agent-memory-service
 * inherited the platform-prefixed producer and domain constants (the old
 * names are spelled out in the loop SPEC, not here: the rename's accept sweep
 * greps this tree for them) when its publisher was
 * copied out of agent-admin and reported the wrong producer and domain on the
 * wire for months (T08 + follow-up). Pure rename: every VALUE below is
 * byte-identical to what it was, pinned by
 * `src/__tests__/platform.constants.test.ts`.
 */
export const AGENT_ADMIN_PRODUCER = "agent-admin-service";
/**
 * The three constants below are genuinely platform-generic and keep their
 * names: every internal producer that publishes on the `platform`/`internal`
 * family uses them (agent-admin, agent-scheduler, agent-memory, and
 * `execution-client`), which is exactly what their names claim.
 *
 * `AUTOMATION_DOMAIN` is NOT agent-admin-specific either — `automation` is
 * the domain token of the whole automation family (agent-admin,
 * agent-scheduler and ai-agent-gateway subjects all carry it). Named
 * `PLATFORM_DOMAIN` until 2026-08-01 (envelope-drift open decision 1): the
 * identifier now says which family the token names; the VALUE on the wire is
 * untouched.
 */
export const AUTOMATION_DOMAIN = "automation";
export const PLATFORM_CHANNEL = "platform";
export const PLATFORM_PROVIDER = "internal";
export const PLATFORM_ACCOUNT_ID = "platform-admin";

export const AGENT_ADMIN_SUBJECT_PREFIX =
  "evt.{tenant}.agent-admin-service.automation.platform.internal";

export const AGENT_ADMIN_CONFIG_SYNC = `${AGENT_ADMIN_SUBJECT_PREFIX}.config_sync.v1`;
export const AGENT_ADMIN_JOBS_SYNC = `${AGENT_ADMIN_SUBJECT_PREFIX}.jobs_sync.v1`;
export const AGENT_ADMIN_JOB_TRIGGER = `${AGENT_ADMIN_SUBJECT_PREFIX}.job_trigger.v1`;
export const AGENT_ADMIN_CHAT_RESPOND = `${AGENT_ADMIN_SUBJECT_PREFIX}.chat_respond.v1`;
// `AGENT_ADMIN_ONLINE` (`…online.v1`) was removed 2026-08-01 (envelope-drift
// open decision 4): no publisher or consumer ever existed in any service.
// Runtime presence heartbeats are agent-ai's `online.v1` on the
// ai-agent-gateway family instead.
export const AGENT_ADMIN_AGENT_OUTBOUND = `${AGENT_ADMIN_SUBJECT_PREFIX}.agent_outbound.v1`;
export const AGENT_ADMIN_EXECUTION_STATUS = `${AGENT_ADMIN_SUBJECT_PREFIX}.execution_status.v1`;
export const AGENT_ADMIN_AGENT_PUBLISHED = `${AGENT_ADMIN_SUBJECT_PREFIX}.agent_published.v1`;
export const AGENT_ADMIN_AGENT_UNPUBLISHED = `${AGENT_ADMIN_SUBJECT_PREFIX}.agent_unpublished.v1`;
export const AGENT_ADMIN_EVENT = `${AGENT_ADMIN_SUBJECT_PREFIX}.event.v1`;
export const AGENT_ADMIN_DOCUMENT_INGESTION = `${AGENT_ADMIN_SUBJECT_PREFIX}.document_ingestion.v1`;
export const AGENT_ADMIN_SKB_FILE_INGESTION = `${AGENT_ADMIN_SUBJECT_PREFIX}.skb_file_ingestion.v1`;
/**
 * Relocated from `services/agent-admin-service/src/providers/nats.provider.ts`
 * on 2026-08-01 (envelope-drift open decision 2 / docs-consistency T02
 * follow-up) — it was the only member of the family still declared inside the
 * service. Value unchanged; agent-ai's consumer subscribes to this subject
 * by pattern (`multi-tenant-consumer.service.ts`).
 */
export const AGENT_ADMIN_SKILL_CHANGED = `${AGENT_ADMIN_SUBJECT_PREFIX}.skill_changed.v1`;
/**
 * agent-memory-service subject family.
 *
 * Unlike every other internal producer, this family's domain token is
 * `agent-memory`, NOT `automation` — the subject grammar (AGENTS.md:64-65) is
 * the spec, and `tracking-ingester` classifies these events by matching these
 * exact tokens (rule 9, TAXONOMY.md §4). The envelope's `domain` field is built
 * from `AGENT_MEMORY_DOMAIN` too, so body and subject cannot disagree; before
 * envelope-drift T08 the envelope borrowed the constant then named
 * `PLATFORM_DOMAIN` (today `AUTOMATION_DOMAIN`, `automation`) and
 * contradicted its own subject.
 */
export const AGENT_MEMORY_PRODUCER = "agent-memory-service";
export const AGENT_MEMORY_DOMAIN = "agent-memory";

export const AGENT_MEMORY_SUBJECT_PREFIX = `evt.{tenant}.${AGENT_MEMORY_PRODUCER}.${AGENT_MEMORY_DOMAIN}.${PLATFORM_CHANNEL}.${PLATFORM_PROVIDER}`;

export const AGENT_MEMORY_PROPOSED = `${AGENT_MEMORY_SUBJECT_PREFIX}.memory_proposed.v1`;
export const AGENT_MEMORY_PUBLISHED = `${AGENT_MEMORY_SUBJECT_PREFIX}.memory_published.v1`;
export const AGENT_MEMORY_REJECTED = `${AGENT_MEMORY_SUBJECT_PREFIX}.memory_rejected.v1`;
export const AGENT_MEMORY_EXPIRED = `${AGENT_MEMORY_SUBJECT_PREFIX}.memory_expired.v1`;

/**
 * ai-agent-gateway's identity and subject family. The four execution subjects
 * were called `PLATFORM_EXECUTION_*` until 2026-07-31 (envelope-drift
 * post-loop item 2): same mis-naming as agent-admin's — a `PLATFORM_` prefix
 * over values that name one service. Pure rename, values byte-identical,
 * pinned by `src/__tests__/agent-admin.constants.test.ts`.
 */
export const AI_AGENT_GATEWAY_PRODUCER = "ai-agent-gateway";
export const AI_AGENT_GATEWAY_SUBJECT_PREFIX =
  "evt.{tenant}.ai-agent-gateway.automation.platform.internal";
export const AI_AGENT_GATEWAY_EXECUTION_REQUESTED = `${AI_AGENT_GATEWAY_SUBJECT_PREFIX}.execution_requested.v1`;
export const AI_AGENT_GATEWAY_EXECUTION_STARTED = `${AI_AGENT_GATEWAY_SUBJECT_PREFIX}.execution_started.v1`;
export const AI_AGENT_GATEWAY_EXECUTION_COMPLETED = `${AI_AGENT_GATEWAY_SUBJECT_PREFIX}.execution_completed.v1`;
export const AI_AGENT_GATEWAY_EXECUTION_FAILED = `${AI_AGENT_GATEWAY_SUBJECT_PREFIX}.execution_failed.v1`;

/**
 * agent-scheduler-service's subject family. `SCHEDULER_HEARTBEAT` was
 * platform-prefixed until 2026-07-31 — same rename, same
 * reason; its value is and was the scheduler's own subject.
 *
 * The prefix is built from the identity constants (like agent-memory's) so
 * the heartbeat envelope's producer/domain/channel/provider fields — which
 * `HeartbeatService` builds from the same constants since 2026-08-01
 * (envelope-drift open decision 3) — cannot disagree with the subject
 * tokens. Value byte-identical, pinned in `agent-admin.constants.test.ts`.
 */
export const AGENT_SCHEDULER_PRODUCER = "agent-scheduler-service";
export const SCHEDULER_SUBJECT_PREFIX = `evt.{tenant}.${AGENT_SCHEDULER_PRODUCER}.${AUTOMATION_DOMAIN}.${PLATFORM_CHANNEL}.${PLATFORM_PROVIDER}`;
export const SCHEDULER_HEARTBEAT = `${SCHEDULER_SUBJECT_PREFIX}.heartbeat.v1`;
/**
 * The heartbeat envelope's `type`. Predates the `io.yoizen.<producer>.…` type
 * convention the other internal producers follow; the value is pinned as-is
 * in `heartbeat.service.spec.ts` because changing it is a wire change.
 */
export const SCHEDULER_HEARTBEAT_TYPE =
  "io.yoizen.platform.scheduler.heartbeat.v1";

export function buildPlatformSubject(
  template: string,
  tenantId: string
): string {
  return template.replaceAll("{tenant}", tenantId);
}

/**
 * Runtime execution token streaming (DOCS/architecture/runtime-streaming.md).
 *
 * Ephemeral, core-NATS-only subjects for per-execution token/tool/cancel
 * events. Deliberately OUTSIDE the `evt.` CloudEvents taxonomy so the
 * per-tenant JetStream stream (`INGRESS-<tenant>`, subject filter
 * `evt.<tenant>.>`) never captures them — token deltas have no replay
 * value and must not be persisted (see §1.1 of the design doc).
 *
 * The envelope carried on these subjects stays fully `isCompliantEnvelope`;
 * only the NATS subject differs from the `evt.` namespace.
 */
export const RUNTIME_STREAM_SUBJECT_PREFIX = "rt.{tenant}.exec.{executionId}";

export const RUNTIME_TOKEN = "token";
export const RUNTIME_TOOL_CALL = "tool_call";
export const RUNTIME_TOOL_RESULT = "tool_result";
export const RUNTIME_CANCEL = "cancel";

export type RuntimeStreamKind =
  | typeof RUNTIME_TOKEN
  | typeof RUNTIME_TOOL_CALL
  | typeof RUNTIME_TOOL_RESULT
  | typeof RUNTIME_CANCEL;

export const RUNTIME_TOKEN_EVENT_TYPE = "io.yoizen.platform.runtime.token.v1";
export const RUNTIME_TOOL_CALL_EVENT_TYPE =
  "io.yoizen.platform.runtime.tool_call.v1";
export const RUNTIME_TOOL_RESULT_EVENT_TYPE =
  "io.yoizen.platform.runtime.tool_result.v1";
export const RUNTIME_CANCEL_EVENT_TYPE = "io.yoizen.platform.runtime.cancel.v1";

/**
 * Builds the ephemeral runtime-stream subject for a given tenant/execution/kind.
 * Guaranteed to never start with `evt.` — see the JetStream-capture invariant above.
 */
export function buildRuntimeStreamSubject(
  tenantId: string,
  executionId: string,
  kind: RuntimeStreamKind
): string {
  const prefix = RUNTIME_STREAM_SUBJECT_PREFIX.replaceAll(
    "{tenant}",
    tenantId
  ).replaceAll("{executionId}", executionId);
  return `${prefix}.${kind}`;
}

/** Wildcard subject matching every ephemeral runtime-stream kind for one execution. */
export function buildRuntimeStreamWildcard(
  tenantId: string,
  executionId: string
): string {
  const prefix = RUNTIME_STREAM_SUBJECT_PREFIX.replaceAll(
    "{tenant}",
    tenantId
  ).replaceAll("{executionId}", executionId);
  return `${prefix}.*`;
}
