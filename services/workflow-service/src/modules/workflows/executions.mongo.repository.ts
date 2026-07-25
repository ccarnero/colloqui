import { Inject, Injectable } from "@nestjs/common";
import type { TenantMongoConnectionManager } from "@yoizen/database";
import type { Filter, WithId } from "mongodb";
import { WorkflowTenantConnectionManager } from "../../providers/tenant-connection-manager";
import type {
  ICreateExecutionParams,
  IExecutionsCountByDefinition,
  IExecutionsRepository,
  IFindExecutionsParams,
  ITopDefinitionRow,
  IWorkflowExecutionRow,
} from "./executions.repository.interface";

interface IWorkflowExecutionDoc {
  _id: string;
  definition_id: string;
  temporal_workflow_id: string;
  temporal_run_id: string;
  correlation_id?: string | null;
  request: Record<string, unknown>;
  status: string;
  created_at: Date;
  updated_at: Date;
}

function toDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }
  return new Date(String(value ?? Date.now()));
}

function docToExecutionRow(
  doc: WithId<IWorkflowExecutionDoc>
): IWorkflowExecutionRow {
  return {
    id: String(doc._id),
    definition_id: String(doc.definition_id ?? ""),
    temporal_workflow_id: String(doc.temporal_workflow_id ?? ""),
    temporal_run_id: String(doc.temporal_run_id ?? ""),
    correlation_id: doc.correlation_id ?? null,
    request: doc.request ?? {},
    status: String(doc.status ?? "RUNNING"),
    created_at: toDate(doc.created_at),
    updated_at: toDate(doc.updated_at),
  };
}

@Injectable()
export class ExecutionsMongoRepository implements IExecutionsRepository {
  constructor(
    @Inject(WorkflowTenantConnectionManager)
    private readonly connections: TenantMongoConnectionManager,
  ) {}

  private async executions(tenantId: string) {
    const db = await this.connections.ensureSchema(tenantId);
    return db.collection<IWorkflowExecutionDoc>("workflow_executions");
  }

  async createExecution(
    params: ICreateExecutionParams
  ): Promise<IWorkflowExecutionRow> {
    const {
      id,
      definitionId,
      tenantId,
      temporalWorkflowId,
      temporalRunId,
      correlationId,
      request,
    } = params;
    const now = new Date();
    const doc: IWorkflowExecutionDoc = {
      _id: id,
      definition_id: definitionId,
      temporal_workflow_id: temporalWorkflowId,
      temporal_run_id: temporalRunId,
      correlation_id: correlationId ?? null,
      request,
      status: "RUNNING",
      created_at: now,
      updated_at: now,
    };
    const col = await this.executions(tenantId);
    await col.insertOne(doc);
    return docToExecutionRow(doc);
  }

  async updateExecutionStatus(
    id: string,
    tenantId: string,
    status: string
  ): Promise<boolean> {
    const col = await this.executions(tenantId);
    const result = await col.updateOne(
      { _id: id },
      { $set: { status, updated_at: new Date() } }
    );
    return result.modifiedCount > 0;
  }

  async findExecutionById(
    id: string,
    tenantId: string
  ): Promise<IWorkflowExecutionRow | undefined> {
    const col = await this.executions(tenantId);
    const doc = await col.findOne({ _id: id });
    return doc ? docToExecutionRow(doc) : undefined;
  }

  async findExecutionsByDefinition(
    params: IFindExecutionsParams
  ): Promise<IWorkflowExecutionRow[]> {
    const { definitionId, tenantId, limit, offset, sort } = params;
    const col = await this.executions(tenantId);
    const filter: Filter<IWorkflowExecutionDoc> = {
      definition_id: definitionId,
    };
    const sortSpec =
      sort === "asc" ? { created_at: 1 as const } : { created_at: -1 as const };
    const docs = await col
      .find(filter)
      .sort(sortSpec)
      .skip(offset)
      .limit(limit)
      .toArray();
    return docs.map(docToExecutionRow);
  }

  async findExecutionsByCorrelation(
    correlationId: string,
    tenantId: string
  ): Promise<IWorkflowExecutionRow[]> {
    const col = await this.executions(tenantId);
    const docs = await col
      .find({ correlation_id: correlationId })
      .sort({ created_at: 1 })
      .toArray();
    return docs.map(docToExecutionRow);
  }

  async countExecutionsByDefinition(
    definitionId: string,
    tenantId: string
  ): Promise<number> {
    const col = await this.executions(tenantId);
    return col.countDocuments({ definition_id: definitionId });
  }

  async countExecutionsGroupedByDefinition(
    tenantId: string
  ): Promise<IExecutionsCountByDefinition[]> {
    const col = await this.executions(tenantId);
    const rows = await col
      .aggregate<{ _id: string; count: number }>([
        { $group: { _id: "$definition_id", count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ])
      .toArray();
    const out: IExecutionsCountByDefinition[] = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      out[i] = { definition_id: row._id, count: row.count };
    }
    return out;
  }

  async countFailingByLastRun(tenantId: string): Promise<number> {
    const col = await this.executions(tenantId);
    const terminalStatuses = [
      "COMPLETED",
      "FAILED",
      "TIMED_OUT",
      "CANCELLED",
      "TERMINATED",
    ];
    // Group by definition_id, sort by created_at desc, take first — then
    // count those whose status is not COMPLETED.
    const rows = await col
      .aggregate<{ total?: number }>([
        { $match: { status: { $in: terminalStatuses } } },
        { $sort: { created_at: -1 } },
        { $group: { _id: "$definition_id", status: { $first: "$status" } } },
        { $match: { status: { $ne: "COMPLETED" } } },
        { $count: "total" },
      ])
      .toArray();
    return rows[0]?.total ?? 0;
  }

  async countFailingByWindow7d(tenantId: string, since: Date): Promise<number> {
    const col = await this.executions(tenantId);
    const failStatuses = ["FAILED", "TIMED_OUT", "CANCELLED", "TERMINATED"];
    const rows = await col
      .aggregate<{ total: number }>([
        {
          $match: {
            status: { $in: failStatuses },
            created_at: { $gte: since },
          },
        },
        { $group: { _id: "$definition_id" } },
        { $count: "total" },
      ])
      .toArray();
    return rows[0]?.total ?? 0;
  }

  async countExecutionsByStatusSince(
    tenantId: string,
    statuses: string[],
    since: Date
  ): Promise<number> {
    const col = await this.executions(tenantId);
    return col.countDocuments({
      status: { $in: statuses },
      created_at: { $gte: since },
    });
  }

  async topDefinitionsByExecutionCount(
    tenantId: string,
    since: Date,
    limit: number
  ): Promise<ITopDefinitionRow[]> {
    // Mongo repo does not have cross-collection JOIN access; returns best-effort
    // with name/application as empty strings (Postgres repo has the JOIN).
    const col = await this.executions(tenantId);
    const rows = await col
      .aggregate<{ _id: string; count: number }>([
        { $match: { created_at: { $gte: since } } },
        { $group: { _id: "$definition_id", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: limit },
      ])
      .toArray();
    return rows.map((r) => ({
      definition_id: r._id,
      name: "",
      application: "",
      count: r.count,
    }));
  }

  async findCorrelationIdsByDefinition(
    definitionId: string,
    tenantId: string,
    since: Date,
    limit: number
  ): Promise<string[]> {
    const col = await this.executions(tenantId);
    const rows = await col
      .aggregate<{ _id: string }>([
        {
          $match: {
            definition_id: definitionId,
            correlation_id: { $ne: null },
            created_at: { $gte: since },
          },
        },
        { $group: { _id: "$correlation_id" } },
        { $limit: limit },
      ])
      .toArray();
    return rows.map((r) => r._id);
  }
}
