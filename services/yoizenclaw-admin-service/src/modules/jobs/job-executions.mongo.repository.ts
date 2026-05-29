import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Filter, WithId } from "mongodb";
import type { IStringIdDoc, TenantMongoConnectionManager } from "@yoizen/database";
import { TenantScopedMongoRepository } from "../../providers/tenant-scoped.repository";
import { YoizenclawTenantConnectionManager } from "../../providers/tenant-connection-manager";
import type {
  ICreateExecutionData,
  IFindAllExecutionsOptions,
  IJobExecution,
  IJobExecutionsRepository,
} from "./job-executions.repository.interface";

function docToExecution(doc: WithId<IStringIdDoc>): IJobExecution {
  return {
    id: String(doc._id),
    job_id: String(doc.job_id ?? ""),
    job_name: doc.job_name ? String(doc.job_name) : undefined,
    status: String(doc.status ?? "pending") as IJobExecution["status"],
    event_payload: (doc.event_payload as Record<string, unknown>) ?? {},
    result: (doc.result as Record<string, unknown> | null) ?? null,
    logs: Array.isArray(doc.logs) ? doc.logs.map((l) => String(l)) : [],
    error_message:
      doc.error_message === null || doc.error_message === undefined
        ? null
        : String(doc.error_message),
    retry_count: Number(doc.retry_count ?? 0),
    triggered_by:
      doc.triggered_by === null || doc.triggered_by === undefined
        ? null
        : String(doc.triggered_by),
    started_at:
      doc.started_at instanceof Date
        ? doc.started_at
        : doc.started_at
          ? new Date(String(doc.started_at))
          : null,
    finished_at:
      doc.finished_at instanceof Date
        ? doc.finished_at
        : doc.finished_at
          ? new Date(String(doc.finished_at))
          : null,
    created_at:
      doc.created_at instanceof Date
        ? doc.created_at
        : new Date(String(doc.created_at ?? Date.now())),
  };
}

@Injectable()
export class JobExecutionsMongoRepository extends TenantScopedMongoRepository implements IJobExecutionsRepository {
  constructor(
    @Inject(YoizenclawTenantConnectionManager)
    connectionManager: TenantMongoConnectionManager,
  ) {
    super(connectionManager);
  }

  async findAll(
    tenantId: string,
    options: IFindAllExecutionsOptions = {},
  ): Promise<{ executions: IJobExecution[]; total: number }> {
    const db = await this.getDb(tenantId);
    const { job_id, status, limit = 20, offset = 0 } = options;
    const match: Filter<IStringIdDoc> = {};
    if (job_id) match.job_id = job_id;
    if (status) match.status = status;

    const pipeline = [
      { $match: match },
      {
        $lookup: {
          from: "jobs",
          localField: "job_id",
          foreignField: "_id",
          as: "job",
        },
      },
      {
        $addFields: {
          job_name: { $arrayElemAt: ["$job.name", 0] },
        },
      },
      { $sort: { created_at: -1 } },
      {
        $facet: {
          total: [{ $count: "count" }],
          rows: [{ $skip: offset }, { $limit: limit }],
        },
      },
    ];

    const [result] = await db
      .collection<IStringIdDoc>("job_executions")
      .aggregate(pipeline)
      .toArray();
    const total = Number(result?.total?.[0]?.count ?? 0);
    const rows = (result?.rows ?? []) as WithId<IStringIdDoc>[];
    return { executions: rows.map(docToExecution), total };
  }

  async create(
    tenantId: string,
    data: ICreateExecutionData,
  ): Promise<IJobExecution> {
    const db = await this.getDb(tenantId);
    const now = new Date();
    const doc = {
      _id: randomUUID(),
      job_id: data.job_id,
      status: data.status,
      event_payload: data.event_payload ?? {},
      result: null,
      logs: [],
      error_message: null,
      retry_count: 0,
      triggered_by: data.triggered_by ?? "manual",
      started_at: data.status === "running" ? now : null,
      finished_at: null,
      created_at: now,
    };
    await db.collection<IStringIdDoc>("job_executions").insertOne(doc);
    return docToExecution(doc as WithId<IStringIdDoc>);
  }
}
