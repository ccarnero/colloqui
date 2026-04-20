import { Inject, Injectable } from "@nestjs/common";
import type { Sql } from "postgres";
import { POSTGRES_SQL } from "../../providers/postgres.provider";

export interface IExecutionStatusRow {
  id: string;
  status: string;
}

/**
 * Batched writer for workflow_executions status projections.
 *
 * Performs a single SQL round-trip per batch using UNNEST expansion
 * of two parallel arrays (ids, statuses) — this is O(N) in the DB
 * engine but one network hop, which is the critical cost.
 *
 * We use UPDATE (not UPSERT) because the primary row is always
 * created by `WorkflowsService.executeWorkflow` before any status
 * event can be emitted. If a row is missing, the count simply won't
 * match the batch size — the caller logs it for investigation.
 */
@Injectable()
export class ExecutionsProjectionRepository {
  constructor(@Inject(POSTGRES_SQL) private readonly sql: Sql) {}

  /**
   * Applies a batch of status updates in a single statement.
   *
   * @returns Number of rows actually updated. When less than
   *   `rows.length`, some executions were missing from the DB.
   */
  async applyStatusBatch(rows: IExecutionStatusRow[]): Promise<number> {
    if (rows.length === 0) return 0;

    const ids = new Array<string>(rows.length);
    const statuses = new Array<string>(rows.length);
    for (let i = 0; i < rows.length; i++) {
      ids[i] = rows[i]!.id;
      statuses[i] = rows[i]!.status;
    }

    // `workflow_executions.id` is declared as TEXT (see the DDL in
    // `infrastructure/base/postgres/configmap.yaml`) and execution ids
    // are produced with `nanoid()` in `WorkflowsService.executeWorkflow`
    // — they are NOT UUIDs. Casting to `uuid[]` here used to blow up
    // every batch with `invalid input syntax for type uuid`, which
    // NAK'd the whole batch and trapped the `workflow-projector`
    // consumer in a redelivery loop (observed: ack_floor.stream_seq=0,
    // num_redelivered=109). Plain `text[]` matches the column type and
    // keeps `WHERE we.id = v.id` a safe string compare.
    const result = await this.sql`
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
