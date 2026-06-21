import type { EventEnvelope } from "@yoizen/shared";
import type { IAuditQueryParams } from "../../common/audit-query-params";

export const AUDIT_REPOSITORY = Symbol("AUDIT_REPOSITORY");

export interface IAuditEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  subject: string;
  created_at: string;
  correlation_id?: string | null;
  causation_id?: string | null;
  depth?: number;
}

export interface IAuditRepository {
  insertAuditEvent(
    tenantId: string,
    envelope: EventEnvelope,
    subject: string,
  ): Promise<void>;
  queryEvents(
    params: IAuditQueryParams,
    tenantId: string,
  ): Promise<IAuditEvent[]>;
  getEventById(id: string, tenantId: string): Promise<IAuditEvent | null>;
  findByCorrelationId(
    correlationId: string,
    tenantId: string,
  ): Promise<IAuditEvent[]>;
}
