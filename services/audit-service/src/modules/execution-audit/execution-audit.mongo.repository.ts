import { Inject, Injectable } from "@nestjs/common";
import {
  type IStringIdDoc,
  isMongoDuplicateKeyError,
  type TenantMongoConnectionManager,
} from "@yoizen/database";
import {
  type EventEnvelope,
  EXECUTION_AUDIT_EVENTS_MONGO_SCHEMA,
  EXECUTION_AUDIT_MONGO_NAMESPACE,
} from "@yoizen/shared";
import type { Filter } from "mongodb";
import { ensureTenantNamespaceOnce } from "../../common/ensure-tenant-schema";
import {
  type IExecutionLifecyclePayload,
  type IStoredExecutionEvent,
  mapExecutionAuditDoc,
} from "../../common/execution-audit-projection";
import { AuditTenantConnectionManager } from "../../providers/tenant-connection-manager";
import type {
  IExecutionAuditQueryParams,
  IExecutionAuditRepository,
} from "./execution-audit.repository.interface";

@Injectable()
export class ExecutionAuditMongoRepository
  implements IExecutionAuditRepository
{
  constructor(
    @Inject(AuditTenantConnectionManager)
    private readonly tenantConnections: TenantMongoConnectionManager,
  ) {}

  private async executionEventsCollection(tenantId: string) {
    const db = await ensureTenantNamespaceOnce(
      this.tenantConnections,
      tenantId,
      EXECUTION_AUDIT_MONGO_NAMESPACE,
      EXECUTION_AUDIT_EVENTS_MONGO_SCHEMA
    );
    return db.collection<IStringIdDoc>("execution_events");
  }

  async insertExecutionEvent(
    envelope: EventEnvelope,
    payload: IExecutionLifecyclePayload,
    _natsSubject: string
  ): Promise<void> {
    const tenantId = envelope.tenant;
    if (!tenantId) {
      return;
    }

    const collection = await this.executionEventsCollection(tenantId);
    const status = payload.reason ?? payload.state ?? null;

    const doc = {
      _id: envelope.id,
      tenant_id: tenantId,
      execution_id: payload.executionId,
      event_kind: payload.state,
      agent_id: payload.agentId ?? null,
      conversation_id: envelope.correlation_id ?? null,
      model: payload.model ?? null,
      provider: payload.provider ?? null,
      input_tokens: payload.usage?.inputTokens ?? null,
      output_tokens: payload.usage?.outputTokens ?? null,
      cached_input_tokens: payload.usage?.cachedInputTokens ?? null,
      cost_usd: payload.costUsd ?? null,
      status,
      error: payload.error ?? null,
      correlation_id: envelope.correlation_id ?? null,
      causation_id: envelope.causation_id ?? null,
      depth: envelope.transport?.depth ?? 0,
      occurred_at: new Date(envelope.time ?? new Date().toISOString()),
      created_at: new Date(),
    };

    try {
      await collection.insertMany([doc], { ordered: false });
    } catch (error) {
      if (isMongoDuplicateKeyError(error)) {
        return;
      }
      throw error;
    }
  }

  async queryEvents(
    params: IExecutionAuditQueryParams,
    tenantId: string
  ): Promise<IStoredExecutionEvent[]> {
    const { executionId, conversationId, agentId, from, to, limit, offset } =
      params;
    const collection = await this.executionEventsCollection(tenantId);

    const filter: Filter<IStringIdDoc> = {};
    if (executionId) {
      filter.execution_id = executionId;
    }
    if (conversationId) {
      filter.conversation_id = conversationId;
    }
    if (agentId) {
      filter.agent_id = agentId;
    }
    if (from || to) {
      const occurredAt: Record<string, Date> = {};
      if (from) {
        occurredAt.$gte = new Date(from);
      }
      if (to) {
        occurredAt.$lte = new Date(to);
      }
      filter.occurred_at = occurredAt;
    }

    const docs = await collection
      .find(filter)
      .sort({ occurred_at: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    return docs.map((doc) => mapExecutionAuditDoc(doc));
  }

  async getEventById(
    id: string,
    tenantId: string
  ): Promise<IStoredExecutionEvent | null> {
    const collection = await this.executionEventsCollection(tenantId);
    const doc = await collection.findOne({ _id: id });
    return doc ? mapExecutionAuditDoc(doc) : null;
  }
}
