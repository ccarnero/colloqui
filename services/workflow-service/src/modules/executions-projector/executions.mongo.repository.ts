import { Inject, Injectable } from "@nestjs/common";
import type { AnyBulkWriteOperation, Collection } from "mongodb";
import { isFatalMongoError, type TenantMongoConnectionManager } from "@yoizen/database";
import { WorkflowTenantConnectionManager } from "../../providers/tenant-connection-manager";
import type {
  IExecutionStatusRow,
  IExecutionsProjectionRepository,
} from "./executions.repository.interface";

interface IWorkflowExecutionDoc {
  _id: string;
  status: string;
  updated_at: Date;
}

@Injectable()
export class ExecutionsProjectionMongoRepository
  implements IExecutionsProjectionRepository
{
  constructor(
    @Inject(WorkflowTenantConnectionManager)
    private readonly connections: TenantMongoConnectionManager,
  ) {}

  async applyStatusBatch(
    tenantId: string,
    rows: IExecutionStatusRow[],
  ): Promise<number> {
    if (rows.length === 0) return 0;

    const db = await this.connections.ensureSchema(tenantId);
    const col = db.collection<IWorkflowExecutionDoc>("workflow_executions");
    const ops = this.buildBulkOps(rows);

    return this.bulkWriteWithReconnect(tenantId, col, ops);
  }

  private buildBulkOps(
    rows: IExecutionStatusRow[],
  ): AnyBulkWriteOperation<IWorkflowExecutionDoc>[] {
    const now = new Date();
    const ops: AnyBulkWriteOperation<IWorkflowExecutionDoc>[] = new Array(
      rows.length,
    );
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      ops[i] = {
        updateOne: {
          filter: { _id: row.id },
          update: { $set: { status: row.status, updated_at: now } },
        },
      };
    }
    return ops;
  }

  /**
   * Retries once after evicting a stale Mongo client (e.g. after
   * `Topology is closed` when mongo-platform restarted mid-run).
   */
  private async bulkWriteWithReconnect(
    tenantId: string,
    col: Collection<IWorkflowExecutionDoc>,
    ops: AnyBulkWriteOperation<IWorkflowExecutionDoc>[],
  ): Promise<number> {
    try {
      const result = await col.bulkWrite(ops, { ordered: false });
      return result.modifiedCount;
    } catch (err: unknown) {
      if (!isFatalMongoError(err)) {
        throw err;
      }
      await this.connections.evictTenant(tenantId);
      const db = await this.connections.ensureSchema(tenantId);
      const retryCol =
        db.collection<IWorkflowExecutionDoc>("workflow_executions");
      const result = await retryCol.bulkWrite(ops, { ordered: false });
      return result.modifiedCount;
    }
  }
}
