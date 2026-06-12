import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Document, Filter, WithId } from "mongodb";
import type { IStringIdDoc, TenantMongoConnectionManager } from "@yoizen/database";
import { TenantScopedMongoRepository } from "../../providers/tenant-scoped.repository";
import { YoizenclawTenantConnectionManager } from "../../providers/tenant-connection-manager";
import type {
  ICreateJobData,
  IFindAllJobsOptions,
  IJob,
  IJobsRepository,
  IUpdateJobData,
} from "./jobs.repository.interface";
import { calculateNextRun } from "./schedule.utils";

function docToJob(doc: WithId<IStringIdDoc>): IJob {
  return {
    id: String(doc._id),
    name: String(doc.name ?? ""),
    agent_id: String(doc.agent_id ?? ""),
    schedule: String(doc.schedule ?? ""),
    payload: (doc.payload as Record<string, unknown>) ?? {},
    is_active: Boolean(doc.is_active ?? true),
    last_run:
      doc.last_run instanceof Date
        ? doc.last_run
        : doc.last_run
          ? new Date(String(doc.last_run))
          : null,
    next_run:
      doc.next_run instanceof Date
        ? doc.next_run
        : doc.next_run
          ? new Date(String(doc.next_run))
          : null,
    created_at:
      doc.created_at instanceof Date
        ? doc.created_at
        : new Date(String(doc.created_at ?? Date.now())),
    updated_at:
      doc.updated_at instanceof Date
        ? doc.updated_at
        : new Date(String(doc.updated_at ?? Date.now())),
  };
}

@Injectable()
export class JobsMongoRepository extends TenantScopedMongoRepository implements IJobsRepository {
  constructor(
    @Inject(YoizenclawTenantConnectionManager)
    connectionManager: TenantMongoConnectionManager,
  ) {
    super(connectionManager);
  }

  async findAll(
    tenantId: string,
    options: IFindAllJobsOptions = {},
  ): Promise<{ jobs: IJob[]; total: number }> {
    const db = await this.getDb(tenantId);
    const col = db.collection<IStringIdDoc>("jobs");
    const { agent_id, is_active, limit = 20, offset = 0 } = options;
    const filter: Filter<IStringIdDoc> = {};
    if (agent_id) filter.agent_id = agent_id;
    if (is_active !== undefined) filter.is_active = is_active;

    const total = await col.countDocuments(filter);
    const docs = await col
      .find(filter)
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();
    return { jobs: docs.map(docToJob), total };
  }

  async findById(tenantId: string, id: string): Promise<IJob | null> {
    const db = await this.getDb(tenantId);
    const doc = await db.collection<IStringIdDoc>("jobs").findOne({ _id: id });
    return doc ? docToJob(doc) : null;
  }

  async create(tenantId: string, data: ICreateJobData): Promise<IJob> {
    const db = await this.getDb(tenantId);
    const now = new Date();
    const nextRun = calculateNextRun(data.schedule);
    const doc = {
      _id: randomUUID(),
      name: data.name,
      agent_id: data.agent_id,
      schedule: data.schedule,
      payload: data.payload ?? {},
      is_active: data.is_active ?? true,
      last_run: null,
      next_run: nextRun,
      created_at: now,
      updated_at: now,
    };
    await db.collection<IStringIdDoc>("jobs").insertOne(doc);
    return docToJob(doc as WithId<IStringIdDoc>);
  }

  async update(
    tenantId: string,
    id: string,
    data: IUpdateJobData,
  ): Promise<IJob | null> {
    const db = await this.getDb(tenantId);
    const setFields: Document = { updated_at: new Date() };
    if (data.name !== undefined) setFields.name = data.name;
    if (data.agent_id !== undefined) setFields.agent_id = data.agent_id;
    if (data.schedule !== undefined) {
      setFields.schedule = data.schedule;
      setFields.next_run = calculateNextRun(data.schedule);
    }
    if (data.payload !== undefined) setFields.payload = data.payload;
    if (data.is_active !== undefined) setFields.is_active = data.is_active;

    const result = await db.collection<IStringIdDoc>("jobs").findOneAndUpdate(
      { _id: id },
      { $set: setFields },
      { returnDocument: "after" },
    );
    return result ? docToJob(result) : null;
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const db = await this.getDb(tenantId);
    const result = await db.collection<IStringIdDoc>("jobs").deleteOne({ _id: id });
    return result.deletedCount > 0;
  }

  async enable(tenantId: string, id: string): Promise<IJob | null> {
    return this.setActive(tenantId, id, true);
  }

  async disable(tenantId: string, id: string): Promise<IJob | null> {
    return this.setActive(tenantId, id, false);
  }

  async updateLastRun(
    tenantId: string,
    id: string,
    schedule: string,
  ): Promise<IJob | null> {
    const db = await this.getDb(tenantId);
    const result = await db.collection<IStringIdDoc>("jobs").findOneAndUpdate(
      { _id: id },
      {
        $set: {
          last_run: new Date(),
          next_run: calculateNextRun(schedule),
          updated_at: new Date(),
        },
      },
      { returnDocument: "after" },
    );
    return result ? docToJob(result) : null;
  }

  private async setActive(
    tenantId: string,
    id: string,
    isActive: boolean,
  ): Promise<IJob | null> {
    const db = await this.getDb(tenantId);
    const result = await db.collection<IStringIdDoc>("jobs").findOneAndUpdate(
      { _id: id },
      { $set: { is_active: isActive, updated_at: new Date() } },
      { returnDocument: "after" },
    );
    return result ? docToJob(result) : null;
  }

}
