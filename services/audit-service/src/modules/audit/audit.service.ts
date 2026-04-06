import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { Consumer } from "nats";
import { NatsConsumerRunner } from "@yoizen/database";
import { PinoLoggerService } from "@yoizen/observability";
import { JETSTREAM_CLIENT } from "../../providers/nats.provider";
import type { EventEnvelope } from "@yoizen/shared";
import type { IAuditQueryParams } from "../../common/audit-query-params";
import { AuditRepository, type IAuditEvent } from "./audit.repository";

export type { IAuditEvent };

@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new PinoLoggerService(AuditService.name);
  private readonly runner: NatsConsumerRunner;

  constructor(
    @Inject(JETSTREAM_CLIENT) consumer: Consumer,
    private readonly auditRepository: AuditRepository,
  ) {
    this.runner = new NatsConsumerRunner(
      consumer,
      (msg) => this.persistMessage(msg),
      this.logger,
    );
  }

  async onModuleInit(): Promise<void> {
    await this.runner.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.runner.stop();
  }

  private async persistMessage(msg: import("nats").JsMsg): Promise<void> {
    await this.persistAuditEnvelope(msg.json() as EventEnvelope, msg.subject);
  }

  private async persistAuditEnvelope(
    envelope: EventEnvelope,
    subject: string,
  ): Promise<void> {
    const tenantId = envelope.tenant;
    if (!tenantId) {
      this.logger.warn(`Dropping event ${envelope.id}: missing tenant`);
      return;
    }

    await this.auditRepository.insertAuditEvent(tenantId, envelope, subject);
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
