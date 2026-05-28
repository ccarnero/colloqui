import type {
  AuditDashboardStats,
  GatewayAuditEvent,
} from "@yoizen/shared";
import type { IStoredGatewayAuditEvent } from "../../common/gateway-audit-projection";

export const GATEWAY_AUDIT_REPOSITORY = Symbol("GATEWAY_AUDIT_REPOSITORY");

export interface IGatewayAuditQueryParams {
  method?: string;
  routeType?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

export interface IGatewayAuditRepository {
  insertGatewayEvent(tenantId: string, event: GatewayAuditEvent): Promise<void>;
  queryEvents(
    params: IGatewayAuditQueryParams,
    tenantId: string,
  ): Promise<IStoredGatewayAuditEvent[]>;
  getEventByRequestId(
    requestId: string,
    tenantId: string,
  ): Promise<IStoredGatewayAuditEvent | null>;
  getDashboardStats(tenantId: string): Promise<AuditDashboardStats>;
}
