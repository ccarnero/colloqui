import { Injectable } from "@nestjs/common";
import { WorkflowTenantConnectionManager } from "../../providers/tenant-connection-manager";

export interface IExecutionStatusRow {
  id: string;
  status: string;
}

/**
 * Batched writer for workflow_executions status projections, scoped
 * per-tenant since each tenant has its own Postgres instance.
 *
 * A flush performs one SQL round-trip per tenant using UNNEST expansion
 * of two parallel arrays (ids, statuses) — O(N) in the DB engine but
 * one network hop per tenant, which is the critical cost.
 *
 * We use UPDATE (not UPSERT) because the primary row is always
 * created by `WorkflowsService.executeWorkflow` before any status
 * event can be emitted. If a row is missing, the count simply won't
 * match the batch size — the caller logs it for investigation.
 */
@Injectable()
export class ExecutionsProjectionRepository {
  constructor(
    private readonly connections: WorkflowTenantConnectionManager,
  ) {}

  /**
   * Applies a batch of status updates for a single tenant in one statement.
   *
   * @returns Number of rows actually updated. When less than
   *   `rows.length`, some executions were missing from the DB.
   */
  async applyStatusBatch(
    tenantId: string,
    rows: IExecutionStatusRow[],
  ): Promise<number> {
    if (rows.length === 0) return 0;

    const ids = new Array<string>(rows.length);
    const statuses = new Array<string>(rows.length);
    for (let i = 0; i < rows.length; i++) {
      ids[i] = rows[i]!.id;
      statuses[i] = rows[i]!.status;
    }

    const sql = await this.connections.ensureSchema(tenantId);

    // `workflow_executions.id` is declared TEXT (nanoid, not UUID). Using
    // `text[]` matches the column type and keeps `WHERE we.id = v.id`
    // a safe string compare; casting to `uuid[]` would blow up every
    // batch and NAK the whole consumer.
    const result = await sql`
      UPDATE workflow_executions we
      SET status = v.status,
          updated_at = NOW()
      FROM (
        SELECT unnest(${ids}::text[]) AS id,
               unnest(${statuses}::text[]) AS status
      ) AS v
      WHERE we.id = v.id
    `;
    return result.count ?? 0;
  }
}
