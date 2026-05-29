import { Inject, Injectable } from "@nestjs/common";
import type { TenantConnectionManager } from "@yoizen/database";
import { WorkflowTenantConnectionManager } from "../../providers/tenant-connection-manager";
import type {
  IExecutionStatusRow,
  IExecutionsProjectionRepository,
} from "./executions.repository.interface";

@Injectable()
export class ExecutionsProjectionPostgresRepository
  implements IExecutionsProjectionRepository
{
  constructor(
    @Inject(WorkflowTenantConnectionManager)
    private readonly connections: TenantConnectionManager,
  ) {}

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
