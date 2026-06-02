import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { context as otelContext } from "@opentelemetry/api";
import {
  PinoLoggerService,
  logWithEnvelope,
  startNatsConsumerSpan,
  createNatsConsumerMetrics,
  isWorkerMode,
  resolveServiceName,
} from "@yoizen/observability";
import {
  MultiTenantConsumerManager,
  type IMultiTenantConsumerConfig,
} from "@yoizen/database";
import {
  JETSTREAM_MANAGER,
  JETSTREAM_PUBLISHER,
} from "../../providers/nats.provider";
import type {
  JetStreamClient,
  JetStreamManager,
  JsMsg,
} from "nats";
import type { EventEnvelope } from "@yoizen/shared";
import type { IAuditQueryParams } from "../../common/audit-query-params";
import {
  AUDIT_REPOSITORY,
  type IAuditEvent,
  type IAuditRepository,
} from "./audit.repository.interface";

export type { IAuditEvent };

/**
 * Canonical platform-event pattern (wdocs 02 §9.2 / §9.3). Matches
 * `evt.<tenant>.<producer>.platform.<channel>.<provider>.<kind>.v1`
 * across every tenant. Audit-service persists one row per message
 * from the per-tenant `INGRESS-<tenant>` streams via a durable pull
 * consumer (queue-group: `audit-events`).
 */
const CANONICAL_AUDIT_PATTERN = "evt.*.*.platform.>";
const DURABLE_NAME = "audit-events";
const TENANT_STREAM_PATTERN = /^INGRESS-/;
/** Audit writes are I/O-bound Mongo inserts — parallel is safe + faster. */
const HANDLER_CONCURRENCY = 16;

@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new PinoLoggerService(AuditService.name);
  private manager: MultiTenantConsumerManager | null = null;

  constructor(
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
    @Inject(JETSTREAM_PUBLISHER) private readonly js: JetStreamClient,
    @Inject(AUDIT_REPOSITORY)
    private readonly auditRepository: IAuditRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    const ensureOnly = !isWorkerMode();
    const config: IMultiTenantConsumerConfig = {
      streamPattern: TENANT_STREAM_PATTERN,
      durableName: DURABLE_NAME,
      filterSubject: CANONICAL_AUDIT_PATTERN,
      description: "Canonical platform events audit writer",
      metrics: createNatsConsumerMetrics(resolveServiceName("audit-service")),
      runnerOptions: { concurrency: HANDLER_CONCURRENCY },
      ensureOnly,
    };
    this.manager = new MultiTenantConsumerManager(
      this.jsm,
      this.js,
      config,
      (msg: JsMsg) => this.persistJsMessage(msg),
      this.logger,
    );
    await this.manager.start();
    this.logger.log(
      ensureOnly
        ? `Pre-created '${DURABLE_NAME}' durable consumer (api mode, ensure-only)`
        : `Audit durable consumer ('${DURABLE_NAME}') started`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.manager) {
      await this.manager.stop();
      this.manager = null;
    }
  }

  /** JetStream-path handler — throws on failure so runner NAKs. */
  private async persistJsMessage(msg: JsMsg): Promise<void> {
    const envelope = JSON.parse(
      new TextDecoder().decode(msg.data),
    ) as EventEnvelope;
    const { span, context: ctx } = startNatsConsumerSpan(
      resolveServiceName("audit-service"),
      msg.subject,
      msg.headers ?? {
        keys: () => [],
        values: () => [],
        get: () => "",
        set: () => {},
      },
    );
    try {
      await otelContext.with(ctx, () =>
        this.persistAuditEnvelope(envelope, msg.subject),
      );
    } finally {
      span.end();
    }
  }

  private async persistAuditEnvelope(
    envelope: EventEnvelope,
    subject: string,
  ): Promise<void> {
    const tenantId = envelope.tenant;
    if (!tenantId) {
      logWithEnvelope(
        this.logger,
        envelope,
        "audit.persist.dropped",
        "Dropping event: missing tenant",
        "warn",
      );
      return;
    }

    await this.auditRepository.insertAuditEvent(tenantId, envelope, subject);
    logWithEnvelope(
      this.logger,
      envelope,
      "audit.persist.ok",
      `Audit event persisted (subject=${subject})`,
    );
  }

  /**
   * @param params  Query filters including type, date range, and pagination.
   * @param tenantId  Tenant scope for the query.
   * @returns Matching audit events ordered by creation date descending.
   */
  async queryEvents(
    params: IAuditQueryParams,
    tenantId: string,
  ): Promise<IAuditEvent[]> {
    return this.auditRepository.queryEvents(params, tenantId);
  }

  /**
   * @param id  Event primary key.
   * @param tenantId  Tenant scope for the lookup.
   * @returns The matching event or `null`.
   */
  async getEventById(
    id: string,
    tenantId: string,
  ): Promise<IAuditEvent | null> {
    return this.auditRepository.getEventById(id, tenantId);
  }
}
