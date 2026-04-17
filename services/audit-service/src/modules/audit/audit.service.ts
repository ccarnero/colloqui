import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { Msg, NatsConnection, Subscription } from "nats";
import { context as otelContext } from "@opentelemetry/api";
import {
  PinoLoggerService,
  logWithEnvelope,
  startNatsConsumerSpan,
} from "@yoizen/observability";
import { NATS_CONNECTION } from "../../providers/nats.provider";
import type { EventEnvelope } from "@yoizen/shared";
import type { IAuditQueryParams } from "../../common/audit-query-params";
import { AuditRepository, type IAuditEvent } from "./audit.repository";

export type { IAuditEvent };

/**
 * Canonical platform-event pattern (wdocs 02 §9.2 / §9.3). Matches
 * `evt.<tenant>.<producer>.platform.<channel>.<provider>.<kind>.v1`
 * across every tenant. Audit-service persists one row per message
 * straight from this core NATS subscription — the legacy `EVENTS`
 * JetStream consumer has been removed.
 */
const CANONICAL_AUDIT_PATTERN = "evt.*.*.platform.>";

@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new PinoLoggerService(AuditService.name);
  private subscription: Subscription | null = null;

  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    private readonly auditRepository: AuditRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    this.subscription = this.nc.subscribe(CANONICAL_AUDIT_PATTERN, {
      callback: (_err, msg) => {
        this.persistMessage(msg).catch((err) => {
          this.logger.warn(
            `audit persist error: ${err instanceof Error ? err.message : err}`,
          );
        });
      },
    });
    this.logger.log(`Audit subscribed to: ${CANONICAL_AUDIT_PATTERN}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }

  private async persistMessage(msg: Msg): Promise<void> {
    const envelope = JSON.parse(
      new TextDecoder().decode(msg.data),
    ) as EventEnvelope;
    const { span, context: ctx } = startNatsConsumerSpan(
      "audit-service",
      msg.subject,
      msg.headers ?? { keys: () => [], values: () => [], get: () => "", set: () => {} },
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
