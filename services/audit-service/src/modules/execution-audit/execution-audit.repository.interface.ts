import type { EventEnvelope } from "@yoizen/shared";
import type {
  IExecutionLifecyclePayload,
  IStoredExecutionEvent,
} from "../../common/execution-audit-projection";

export const EXECUTION_AUDIT_REPOSITORY = Symbol("EXECUTION_AUDIT_REPOSITORY");

export interface IExecutionAuditQueryParams {
  executionId?: string;
  conversationId?: string;
  agentId?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

export interface IExecutionAuditRepository {
  insertExecutionEvent(
    envelope: EventEnvelope,
    payload: IExecutionLifecyclePayload,
    natsSubject: string
  ): Promise<void>;
  queryEvents(
    params: IExecutionAuditQueryParams,
    tenantId: string
  ): Promise<IStoredExecutionEvent[]>;
  getEventById(
    id: string,
    tenantId: string
  ): Promise<IStoredExecutionEvent | null>;
}
