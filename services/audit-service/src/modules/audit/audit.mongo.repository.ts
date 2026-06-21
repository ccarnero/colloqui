import { Inject, Injectable } from "@nestjs/common";
import {
  isMongoDuplicateKeyError,
  type IStringIdDoc,
  type TenantMongoConnectionManager,
} from "@yoizen/database";
import {
  EVENTS_AUDIT_MONGO_SCHEMA,
  type EventEnvelope,
} from "@yoizen/shared";
import type { Filter } from "mongodb";
import type { IAuditQueryParams } from "../../common/audit-query-params";
import { ensureTenantSchemaOnce } from "../../common/ensure-tenant-schema";
import { AuditTenantConnectionManager } from "../../providers/tenant-connection-manager";
import type { IAuditEvent, IAuditRepository } from "./audit.repository.interface";
import { MAX_CHAIN_NODES } from "./build-chain-tree";

function readCreatedAt(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    return value;
  }
  return new Date().toISOString();
}

function mapEventDoc(doc: Record<string, unknown>): IAuditEvent {
  const payload = doc.payload;
  const metadata = doc.metadata;
  return {
    id: String(doc._id ?? doc.id ?? ""),
    type: String(doc.type ?? ""),
    payload:
      typeof payload === "object" && payload !== null && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {},
    metadata:
      typeof metadata === "object" &&
      metadata !== null &&
      !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : {},
    subject: String(doc.subject ?? ""),
    created_at: readCreatedAt(doc.created_at),
    correlation_id:
      doc.correlation_id != null ? String(doc.correlation_id) : null,
    causation_id: doc.causation_id != null ? String(doc.causation_id) : null,
    depth: typeof doc.depth === "number" ? doc.depth : 0,
  };
}

@Injectable()
export class AuditMongoRepository implements IAuditRepository {
  constructor(
    @Inject(AuditTenantConnectionManager)
    private readonly tenantConnections: TenantMongoConnectionManager,
  ) {}

  private async eventsCollection(tenantId: string) {
    const db = await ensureTenantSchemaOnce(
      this.tenantConnections,
      tenantId,
      EVENTS_AUDIT_MONGO_SCHEMA,
    );
    return db.collection<IStringIdDoc>("events");
  }

  async insertAuditEvent(
    tenantId: string,
    envelope: EventEnvelope,
    subject: string,
  ): Promise<void> {
    const collection = await this.eventsCollection(tenantId);

    const payload = envelope.data.payload ?? {};
    const metadata = {
      tenant: envelope.tenant,
      source: envelope.source,
      correlation_id: envelope.correlation_id,
      traceid: envelope.traceid,
    };

    const doc = {
      _id: envelope.id,
      type: envelope.type,
      payload,
      metadata,
      correlation_id: envelope.correlation_id ?? null,
      causation_id: envelope.causation_id ?? null,
      depth: envelope.transport?.depth ?? 0,
      subject,
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
    params: IAuditQueryParams,
    tenantId: string,
  ): Promise<IAuditEvent[]> {
    const { type, from, to, limit, offset, correlation_id } = params;
    const collection = await this.eventsCollection(tenantId);

    const filter: Filter<IStringIdDoc> = {};
    if (type) {
      filter.type = type;
    }
    if (correlation_id) {
      filter.correlation_id = correlation_id;
    }
    if (from || to) {
      const createdAt: Record<string, Date> = {};
      if (from) {
        createdAt.$gte = new Date(from);
      }
      if (to) {
        createdAt.$lte = new Date(to);
      }
      filter.created_at = createdAt;
    }

    const docs = await collection
      .find(filter)
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    return docs.map((doc) => mapEventDoc(doc as Record<string, unknown>));
  }

  async getEventById(id: string, tenantId: string): Promise<IAuditEvent | null> {
    const collection = await this.eventsCollection(tenantId);
    const doc = await collection.findOne({ _id: id });
    return doc ? mapEventDoc(doc as Record<string, unknown>) : null;
  }

  async findByCorrelationId(
    correlationId: string,
    tenantId: string,
  ): Promise<IAuditEvent[]> {
    const collection = await this.eventsCollection(tenantId);
    const docs = await collection
      .find({ correlation_id: correlationId })
      .sort({ depth: 1, created_at: 1 })
      .limit(MAX_CHAIN_NODES + 1) // fetch one extra to detect truncation at repo level
      .toArray();
    return docs.map((doc) => mapEventDoc(doc as Record<string, unknown>));
  }
}
