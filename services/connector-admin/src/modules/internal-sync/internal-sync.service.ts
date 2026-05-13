import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { context as otelContext, SpanStatusCode } from "@opentelemetry/api";
import type {
  JetStreamClient,
  JetStreamManager,
  JsMsg,
} from "nats";
import {
  MultiTenantConsumerManager,
  type IMultiTenantConsumerConfig,
} from "@yoizen/database";
import {
  PinoLoggerService,
  isWorkerMode,
  logWithEnvelope,
  resolveServiceName,
  startNatsConsumerSpan,
} from "@yoizen/observability";
import {
  ADAPTER_MANAGED_BY_REGISTRY,
  AdapterStatus,
  PermanentError,
  PLATFORM_KIND_SERVICE_DELETED,
  PLATFORM_KIND_SERVICE_UPSERTED,
  SERVICE_DELETED_EVENT_TYPE,
  SERVICE_UPSERTED_EVENT_TYPE,
  type EventEnvelope,
  type IServiceConfigDeletedPayload,
  type IServiceConfigUpsertedPayload,
} from "@yoizen/shared";
import { JETSTREAM, JETSTREAM_MANAGER } from "../../providers/nats.provider";
import { AdaptersRepository } from "../adapters/adapters.repository";
import {
  adapterInternalMirrorEventsTotal,
  adapterInternalMirrorSyncDurationMs,
  adapterInternalSyncCrossTenantAttemptTotal,
  adapterInternalSyncRunnerMetrics,
} from "./internal-sync.metrics";

/**
 * Durable name used across every per-tenant `INGRESS-<tenant>` stream.
 * The same name is reused per stream so KEDA can aggregate
 * `jetstream_consumer_num_pending{consumer_name="adapter-internal-sync"}`
 * across tenants in a single Prometheus query.
 */
const DURABLE_NAME = "adapter-internal-sync";

/** Regex matching every per-tenant ingress stream the manager binds to. */
const TENANT_STREAM_PATTERN = /^INGRESS-/;

/**
 * Cross-tenant subject filter scoped to registry-service platform
 * `service.{upserted,deleted}.v1` events. The `evt.*.…` wildcard mirrors
 * the workflow-triggers pattern: the manager binds one consumer per
 * tenant stream and the stream itself enforces tenant isolation, so
 * the cross-tenant wildcard is functionally equivalent to a per-tenant
 * literal but reuses the canonical platform pattern.
 */
const FILTER_SUBJECT =
  "evt.*.registry-service.platform.service.system.*.v1";

/** ack_wait in ms — anchors the first backoff step (REQ-ASIS-003). */
const ACK_WAIT_MS = 60_000;

/** Backoff schedule (ms) — matches platform default, REQ-ASIS-003. */
const BACKOFF_MS: readonly number[] = [60_000, 120_000, 300_000, 600_000];

/** Max delivery attempts before the runner term()s the message. */
const MAX_DELIVER = 5;

/**
 * Pipeline stage label baked into every {@link PermanentError} thrown
 * here. Lets Grafana alert on `permanent_errors{stage="internal-sync"}`
 * without inspecting individual reasons.
 */
const PERMANENT_ERROR_STAGE = "internal-sync";

interface IServiceEventPayload {
  serviceId?: unknown;
  tenantId?: unknown;
  name?: unknown;
  knativeName?: unknown;
  namespace?: unknown;
  port?: unknown;
  status?: unknown;
  healthCheckPath?: unknown;
}

/**
 * Static set of accepted CloudEvents `type` values. O(1) `Set.has`
 * lookup; any other type → `PermanentError("unknown_type")` (REQ-ASIS-003).
 */
const ACCEPTED_EVENT_TYPES = new Set<string>([
  SERVICE_UPSERTED_EVENT_TYPE,
  SERVICE_DELETED_EVENT_TYPE,
]);

/**
 * Materializes registry-service `service.{upserted,deleted}.v1` events
 * onto the per-tenant `http_adapters` mirror table. Backed by a
 * JetStream durable consumer (one per tenant stream, all sharing the
 * `adapter-internal-sync` durable name) for at-least-once delivery
 * with replay across pod restarts and KEDA scale-from-zero events.
 *
 * Mode semantics ({@link isWorkerMode} → `SERVICE_MODE` env):
 *  - `worker` mode (`apps/v1.Deployment` + KEDA `ScaledObject`):
 *    `ensureOnly: false` — the manager creates the durable on every
 *    `INGRESS-<tenant>` stream AND drives a `NatsConsumerRunner` on
 *    each, pulling messages and acking them.
 *  - `api` mode (`serving.knative.dev/v1.Service`, default):
 *    `ensureOnly: true` — the manager creates / reconciles durables
 *    on every tenant stream but never spawns a runner. This guarantees
 *    `jetstream_consumer_num_pending{consumer_name="adapter-internal-sync"}`
 *    series exist in Prometheus *before* the worker first scales up,
 *    breaking the KEDA cold-start chicken-and-egg loop. Without this
 *    flag, the worker would never wake from 0 replicas because the
 *    metric series wouldn't exist yet to be polled.
 *
 * Error taxonomy (mapped onto JetStream dispositions by the runner):
 *  - handler resolves          → `msg.ack()`
 *  - throws plain `Error`      → `msg.nak()` (transient — will retry
 *                                with backoff `[60s, 120s, 300s, 600s]`)
 *  - throws {@link PermanentError} → `msg.term()` + per-tenant DLQ
 *                                publish (`DLQ-<tenant>` /
 *                                `dlq.<tenant>.<original-subject>`)
 *
 * REQ-ASIS-001/002/003/004/005/006, REQ-AST-002.
 */
@Injectable()
export class InternalSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new PinoLoggerService(InternalSyncService.name);
  private readonly tracerName: string = resolveServiceName("connector-admin");
  private manager: MultiTenantConsumerManager | null = null;

  constructor(
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
    @Inject(JETSTREAM) private readonly js: JetStreamClient,
    private readonly adaptersRepository: AdaptersRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    const ensureOnly = !isWorkerMode();
    const config: IMultiTenantConsumerConfig = {
      streamPattern: TENANT_STREAM_PATTERN,
      durableName: DURABLE_NAME,
      filterSubject: FILTER_SUBJECT,
      description: "connector-admin internal-sync durable",
      metrics: adapterInternalSyncRunnerMetrics,
      runnerOptions: { concurrency: 4 },
      ensureOnly,
      maxDeliver: MAX_DELIVER,
      ackWaitMs: ACK_WAIT_MS,
      backoffMs: BACKOFF_MS,
    };

    this.manager = new MultiTenantConsumerManager(
      this.jsm,
      this.js,
      config,
      (msg: JsMsg) => this.handleJsMessage(msg),
      this.logger,
    );

    await this.manager.start();

    this.logger.log(
      ensureOnly
        ? `Pre-created '${DURABLE_NAME}' durable consumer (api mode, ensure-only)`
        : `Internal-sync durable consumer ('${DURABLE_NAME}') started`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.manager) {
      await this.manager.stop();
      this.manager = null;
    }
  }

  /**
   * Read-only snapshot of every bound stream and whether its
   * `NatsConsumerRunner` reports healthy. O(T) on the bound-stream
   * count (amortised — Map iteration). Used by the health controller's
   * worker-mode `/readyz` gate (REQ-AST-004 durable gate); never
   * mutates manager state.
   *
   * In `ensureOnly: true` mode (api role, REQ-AST-005) the manager
   * never spawns runners, so every entry reports `healthy: false`.
   * The api `/readyz` MUST NOT consult this snapshot — see
   * `HealthService.readiness()`.
   */
  getRunnerHealthSnapshot(): readonly { stream: string; healthy: boolean }[] {
    if (!this.manager) return [];
    const streams = this.manager.getBoundStreams();
    const snapshot: { stream: string; healthy: boolean }[] = [];
    for (let i = 0; i < streams.length; i++) {
      const stream = streams[i] as string;
      const runner = this.manager.getRunner(stream);
      snapshot.push({
        stream,
        healthy: runner?.isHealthy() ?? false,
      });
    }
    return snapshot;
  }

  /**
   * Adapts a JetStream `JsMsg` into the legacy `(subject, data)` pair
   * the rest of the pipeline operates on. Owns the OTEL span lifecycle
   * + duration histogram so the per-message hot path stays linear.
   *
   * Re-thrown errors are propagated to the runner which decides
   * disposition (`PermanentError` → `term`, anything else → `nak`).
   */
  private async handleJsMessage(msg: JsMsg): Promise<void> {
    const incomingHeaders = msg.headers ?? {
      keys: () => [],
      values: () => [],
      get: () => "",
      set: () => {},
    };
    const { span, context: ctx } = startNatsConsumerSpan(
      this.tracerName,
      msg.subject,
      incomingHeaders,
    );
    const started = Date.now();
    try {
      await otelContext.with(ctx, () =>
        this.dispatchEnvelope(msg.subject, msg.data),
      );
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      adapterInternalMirrorSyncDurationMs.record(Date.now() - started);
      span.end();
    }
  }

  /**
   * Decodes the envelope, validates routing/payload invariants and
   * dispatches to the appropriate handler. Throws:
   *   - `PermanentError("parse_error")` on JSON decode failure
   *     (REQ-ASIS-003 malformed envelope).
   *   - `PermanentError("unknown_type")` when the CloudEvents `type`
   *     is not `service.{upserted,deleted}.v1` (REQ-ASIS-003).
   *   - `PermanentError("invalid_payload")` when required fields are
   *     missing.
   *   - `PermanentError("cross_tenant_attempt")` when subject-tenant
   *     and payload-tenant disagree (REQ-ASIS-006).
   *   - any other `Error` propagates as transient (runner naks).
   */
  private async dispatchEnvelope(
    subject: string,
    raw: Uint8Array,
  ): Promise<void> {
    const subjectTenant = this.parseSubjectTenant(subject);
    if (!subjectTenant) {
      throw new PermanentError("invalid_subject", PERMANENT_ERROR_STAGE);
    }

    const envelope = this.parseEnvelope(raw);
    const eventType = this.resolveEventType(envelope, subject);
    if (!ACCEPTED_EVENT_TYPES.has(eventType)) {
      adapterInternalMirrorEventsTotal.add(1, {
        kind: "unknown",
        result: "term",
      });
      throw new PermanentError("unknown_type", PERMANENT_ERROR_STAGE);
    }

    const payload = this.extractPayload(envelope, eventType);
    this.validateTenantScope(subjectTenant, payload);

    if (eventType === SERVICE_UPSERTED_EVENT_TYPE) {
      await this.handleUpserted(envelope, payload as IServiceConfigUpsertedPayload & IServiceEventPayload);
      return;
    }
    await this.handleDeleted(envelope, payload as IServiceConfigDeletedPayload & IServiceEventPayload);
  }

  private parseEnvelope(raw: Uint8Array): EventEnvelope {
    const decoder = new TextDecoder();
    try {
      return JSON.parse(decoder.decode(raw)) as EventEnvelope;
    } catch (err) {
      this.logger.warn(
        `Internal-sync envelope parse failed: ${err instanceof Error ? err.message : err}`,
      );
      throw new PermanentError("parse_error", PERMANENT_ERROR_STAGE);
    }
  }

  /**
   * The subject is the source of truth for tenant routing — token 1 of
   * `evt.<tenant>.registry-service.platform.service.system.<verb>.v1`.
   * Returns `null` when the subject does not honour the 8-token
   * canonical layout, which is itself a poison-message condition.
   */
  private parseSubjectTenant(subject: string): string | null {
    const parts = subject.split(".");
    if (parts.length !== 8) return null;
    const tenant = parts[1];
    return typeof tenant === "string" && tenant.length > 0 ? tenant : null;
  }

  /**
   * Resolves the CloudEvents `type` for the delivery. The publisher
   * sets `envelope.type` to one of `SERVICE_*_EVENT_TYPE`, but as a
   * defensive fallback we also derive the type from the subject's verb
   * token (token 6) so a malformed envelope without `type` is still
   * classified deterministically before reaching the dispatch table.
   */
  private resolveEventType(envelope: EventEnvelope, subject: string): string {
    const declared = envelope.type;
    if (typeof declared === "string" && declared.length > 0) return declared;

    const parts = subject.split(".");
    const verb = parts[6];
    if (verb === PLATFORM_KIND_SERVICE_UPSERTED) return SERVICE_UPSERTED_EVENT_TYPE;
    if (verb === PLATFORM_KIND_SERVICE_DELETED) return SERVICE_DELETED_EVENT_TYPE;
    return "";
  }

  private extractPayload(
    envelope: EventEnvelope,
    eventType: string,
  ): IServiceEventPayload {
    const data = envelope.data as
      | { payload?: Record<string, unknown> }
      | null
      | undefined;
    const payload = data?.payload;
    if (!payload || typeof payload !== "object") {
      logWithEnvelope(
        this.logger,
        envelope,
        "internal-sync.invalid-payload",
        `Missing data.payload on ${eventType} envelope`,
        "warn",
      );
      throw new PermanentError("invalid_payload", PERMANENT_ERROR_STAGE);
    }
    const typed = payload as IServiceEventPayload;
    if (
      typeof typed.tenantId !== "string" ||
      typed.tenantId.length === 0 ||
      typeof typed.name !== "string" ||
      typed.name.length === 0
    ) {
      throw new PermanentError("invalid_payload", PERMANENT_ERROR_STAGE);
    }
    return typed;
  }

  /**
   * Cross-tenant guard: the subject's tenant token is authoritative.
   * Any envelope whose `payload.tenantId` disagrees is a poison
   * message — increments the `cross_tenant_attempt_total` tripwire and
   * throws so the runner term()s + DLQ-routes the delivery.
   * REQ-ASIS-006.
   */
  private validateTenantScope(
    subjectTenant: string,
    payload: IServiceEventPayload,
  ): void {
    const payloadTenant = typeof payload.tenantId === "string" ? payload.tenantId : "";
    if (payloadTenant !== subjectTenant) {
      adapterInternalSyncCrossTenantAttemptTotal.add(1, {
        tenant_subject: subjectTenant,
        tenant_payload: payloadTenant.length > 0 ? payloadTenant : "<missing>",
      });
      adapterInternalMirrorEventsTotal.add(1, {
        kind: "cross_tenant",
        result: "term",
      });
      throw new PermanentError("cross_tenant_attempt", PERMANENT_ERROR_STAGE);
    }
  }

  private async handleUpserted(
    envelope: EventEnvelope,
    payload: IServiceConfigUpsertedPayload & IServiceEventPayload,
  ): Promise<void> {
    const tenantId = this.requireString(payload.tenantId, "tenantId");
    const serviceName = this.requireString(payload.name, "name");
    const knativeName = this.optionalString(payload.knativeName);
    const namespace = this.optionalString(payload.namespace);
    const port = this.coerceNumber(payload.port, 80);
    const statusToken = this.optionalString(payload.status) ?? "active";
    const healthCheckPath =
      this.optionalString(payload.healthCheckPath) ?? "/health";

    if (!tenantId || !serviceName) {
      adapterInternalMirrorEventsTotal.add(1, {
        kind: "upserted",
        result: "skipped",
      });
      return;
    }

    const baseUrl = this.buildInternalBaseUrl(knativeName, namespace, port);
    const status =
      statusToken === "active" ? AdapterStatus.ENABLED : AdapterStatus.DISABLED;

    try {
      await this.adaptersRepository.upsertMirror({
        tenantId,
        serviceName,
        baseUrl,
        healthCheckPath,
        status,
        managedBy: ADAPTER_MANAGED_BY_REGISTRY,
      });
      adapterInternalMirrorEventsTotal.add(1, {
        kind: "upserted",
        result: "ok",
      });
      logWithEnvelope(
        this.logger,
        envelope,
        "internal-sync.upserted.ok",
        `Mirror upserted for service '${serviceName}' (tenant=${tenantId}, baseUrl=${baseUrl})`,
      );
    } catch (err) {
      adapterInternalMirrorEventsTotal.add(1, {
        kind: "upserted",
        result: "error",
      });
      logWithEnvelope(
        this.logger,
        envelope,
        "internal-sync.upserted.error",
        `Mirror upsert failed for '${serviceName}': ${err instanceof Error ? err.message : err}`,
        "error",
      );
      throw err;
    }
  }

  private async handleDeleted(
    envelope: EventEnvelope,
    payload: IServiceConfigDeletedPayload & IServiceEventPayload,
  ): Promise<void> {
    const tenantId = this.requireString(payload.tenantId, "tenantId");
    const serviceName = this.requireString(payload.name, "name");
    if (!tenantId || !serviceName) {
      adapterInternalMirrorEventsTotal.add(1, {
        kind: "deleted",
        result: "skipped",
      });
      return;
    }

    try {
      const count = await this.adaptersRepository.deleteMirrorByServiceName(
        tenantId,
        serviceName,
        ADAPTER_MANAGED_BY_REGISTRY,
      );
      adapterInternalMirrorEventsTotal.add(1, {
        kind: "deleted",
        result: count > 0 ? "ok" : "skipped",
      });
      logWithEnvelope(
        this.logger,
        envelope,
        "internal-sync.deleted.ok",
        `Mirror deleted for service '${serviceName}' (tenant=${tenantId}, rows=${count})`,
      );
    } catch (err) {
      adapterInternalMirrorEventsTotal.add(1, {
        kind: "deleted",
        result: "error",
      });
      logWithEnvelope(
        this.logger,
        envelope,
        "internal-sync.deleted.error",
        `Mirror delete failed for '${serviceName}': ${err instanceof Error ? err.message : err}`,
        "error",
      );
      throw err;
    }
  }

  private buildInternalBaseUrl(
    knativeName: string | null,
    namespace: string | null,
    port: number,
  ): string {
    if (knativeName && namespace) {
      return `http://${knativeName}.${namespace}.svc.cluster.local`;
    }
    return `http://${knativeName ?? "unknown"}:${port}`;
  }

  private requireString(raw: unknown, field: string): string {
    if (typeof raw === "string" && raw.length > 0) return raw;
    this.logger.warn(
      `Internal-sync payload missing required field '${field}'`,
    );
    return "";
  }

  private optionalString(raw: unknown): string | null {
    return typeof raw === "string" && raw.length > 0 ? raw : null;
  }

  private coerceNumber(raw: unknown, fallback: number): number {
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string") {
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n)) return n;
    }
    return fallback;
  }
}
