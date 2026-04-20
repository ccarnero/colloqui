import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { context as otelContext, SpanStatusCode } from "@opentelemetry/api";
import type { Msg, NatsConnection, Subscription } from "nats";
import {
  PinoLoggerService,
  logWithEnvelope,
  startNatsConsumerSpan,
} from "@yoizen/observability";
import {
  ADAPTER_MANAGED_BY_REGISTRY,
  AdapterStatus,
  PLATFORM_KIND_SERVICE_DELETED,
  PLATFORM_KIND_SERVICE_UPSERTED,
  PLATFORM_RESOURCE_SERVICE,
  type EventEnvelope,
  type IServiceConfigDeletedPayload,
  type IServiceConfigUpsertedPayload,
} from "@yoizen/shared";
import { NATS_CONNECTION } from "../../providers/nats.provider";
import { AdaptersRepository } from "../adapters/adapters.repository";
import {
  adapterInternalMirrorEventsTotal,
  adapterInternalMirrorSyncDurationMs,
} from "./internal-sync.metrics";

/**
 * Cross-tenant subject pattern the consumer watches. Every
 * registry-service `service.{upserted,deleted}.v1` envelope lands here,
 * regardless of tenant. See `buildRegistryPlatformSubject` in shared.
 */
const INTERNAL_SYNC_SUBJECT_PATTERN = "evt.*.registry-service.platform.service.system.*.v1";

/** Queue group so multiple adapter-service replicas load-balance events. */
const INTERNAL_SYNC_QUEUE = "adapter-internal-sync";

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

@Injectable()
export class InternalSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new PinoLoggerService(InternalSyncService.name);
  private subscription: Subscription | null = null;

  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    private readonly adaptersRepository: AdaptersRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    this.subscription = this.nc.subscribe(INTERNAL_SYNC_SUBJECT_PATTERN, {
      queue: INTERNAL_SYNC_QUEUE,
      callback: (_err, msg) => {
        this.handleMessage(msg).catch((err) => {
          this.logger.warn(
            `Internal-sync handler error: ${err instanceof Error ? err.message : err}`,
          );
        });
      },
    });
    this.logger.log(
      `Internal-sync subscribed to: ${INTERNAL_SYNC_SUBJECT_PATTERN} (queue=${INTERNAL_SYNC_QUEUE})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }

  private async handleMessage(msg: Msg): Promise<void> {
    const decoder = new TextDecoder();
    let envelope: EventEnvelope;
    try {
      envelope = JSON.parse(decoder.decode(msg.data)) as EventEnvelope;
    } catch (err) {
      this.logger.warn(
        `Dropping non-JSON internal-sync message: ${err instanceof Error ? err.message : err}`,
      );
      return;
    }

    const incomingHeaders = msg.headers ?? {
      keys: () => [],
      values: () => [],
      get: () => "",
      set: () => {},
    };
    const { span, context: ctx } = startNatsConsumerSpan(
      "adapter-service",
      msg.subject,
      incomingHeaders,
    );
    const started = Date.now();
    try {
      await otelContext.with(ctx, () => this.dispatch(envelope, msg.subject));
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      adapterInternalMirrorSyncDurationMs.record(Date.now() - started);
      span.end();
    }
  }

  private async dispatch(
    envelope: EventEnvelope,
    subject: string,
  ): Promise<void> {
    const kind = this.parseKind(subject);
    if (!kind) {
      logWithEnvelope(
        this.logger,
        envelope,
        "internal-sync.skipped.subject",
        `Dropping unknown internal-sync subject: ${subject}`,
        "warn",
      );
      adapterInternalMirrorEventsTotal.add(1, {
        kind: "unknown",
        result: "skipped",
      });
      return;
    }

    if (kind === PLATFORM_KIND_SERVICE_UPSERTED) {
      await this.handleUpserted(envelope);
      return;
    }
    if (kind === PLATFORM_KIND_SERVICE_DELETED) {
      await this.handleDeleted(envelope);
      return;
    }
  }

  private parseKind(subject: string): string | null {
    const parts = subject.split(".");
    if (parts.length !== 8) return null;
    if (parts[4] !== PLATFORM_RESOURCE_SERVICE) return null;
    return parts[6] ?? null;
  }

  private async handleUpserted(envelope: EventEnvelope): Promise<void> {
    const payload = this.extractPayload<IServiceConfigUpsertedPayload>(
      envelope,
      "upserted",
    );
    if (!payload) return;

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

  private async handleDeleted(envelope: EventEnvelope): Promise<void> {
    const payload = this.extractPayload<IServiceConfigDeletedPayload>(
      envelope,
      "deleted",
    );
    if (!payload) return;

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

  private extractPayload<T>(
    envelope: EventEnvelope,
    kind: string,
  ): (T & IServiceEventPayload) | null {
    const data = envelope.data as
      | { payload?: Record<string, unknown> }
      | null
      | undefined;
    const payload = data?.payload;
    if (!payload || typeof payload !== "object") {
      adapterInternalMirrorEventsTotal.add(1, {
        kind,
        result: "skipped",
      });
      logWithEnvelope(
        this.logger,
        envelope,
        "internal-sync.invalid-payload",
        `Missing data.payload on ${kind} envelope`,
        "warn",
      );
      return null;
    }
    return payload as T & IServiceEventPayload;
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
