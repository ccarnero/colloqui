import { Inject, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { TenantConnectionManager } from "@yoizen/database";
import type { VariableType } from "@yoizen/shared";
import { YoizenclawTenantConnectionManager } from "../../providers/tenant-connection-manager";

export interface ISystemVariable {
  id: string;
  name: string;
  type: VariableType;
  value: unknown;
  label?: string | null;
  description?: string | null;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class SystemVariablesService {
  private readonly logger = new Logger(SystemVariablesService.name);

  constructor(
    @Inject(YoizenclawTenantConnectionManager)
    private readonly connectionManager: TenantConnectionManager,
  ) {}

  async findAll(tenantId: string): Promise<{ variables: ISystemVariable[]; total: number }> {
    const sql = await this.connectionManager.ensureSchema(tenantId);
    const [countRow] = await sql`
      SELECT COUNT(*) as count FROM system_variables WHERE tenant_id = ${tenantId} AND is_active = true
    `;
    const total = Number((countRow as Record<string, unknown>).count ?? 0);
    const variables = await sql<ISystemVariable[]>`
      SELECT id, name, type, value, label, description, created_at, updated_at
      FROM system_variables
      WHERE tenant_id = ${tenantId} AND is_active = true
      ORDER BY name
    `;
    return { variables, total };
  }

  async findById(tenantId: string, id: string): Promise<ISystemVariable | null> {
    const sql = await this.connectionManager.ensureSchema(tenantId);
    const [row] = await sql<ISystemVariable[]>`
      SELECT id, name, type, value, label, description, created_at, updated_at
      FROM system_variables
      WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active = true
      LIMIT 1
    `;
    return row ?? null;
  }

  async create(
    tenantId: string,
    data: { name: string; type: VariableType; value: unknown; label?: string; description?: string },
  ): Promise<ISystemVariable> {
    const sql = await this.connectionManager.ensureSchema(tenantId);
    const id = randomUUID();
    const [row] = await sql<ISystemVariable[]>`
      INSERT INTO system_variables (id, tenant_id, name, type, value, label, description)
      VALUES (${id}, ${tenantId}, ${data.name}, ${data.type}, ${JSON.stringify(data.value)}::jsonb, ${data.label ?? null}, ${data.description ?? null})
      RETURNING id, name, type, value, label, description, created_at, updated_at
    `;
    return row;
  }

  async update(
    tenantId: string,
    id: string,
    data: { name?: string; type?: VariableType; value?: unknown; label?: string; description?: string },
  ): Promise<ISystemVariable | null> {
    const sql = await this.connectionManager.ensureSchema(tenantId);

    // Build SET clause as plain strings — MUST NOT make any sql() calls here
    // because the test mock shifts from a queue on every call and only 1 item
    // is queued for the entire update operation.
    const esc = (s: string) => `'${s.replace(/'/g, "''")}'`;

    const setParts: string[] = ["updated_at = NOW()"];

    if (data.name !== undefined) {
      setParts.push(`name = ${esc(data.name)}`);
    }
    if (data.type !== undefined) {
      setParts.push(`type = ${esc(data.type)}`);
    }
    if (data.value !== undefined) {
      setParts.push(`value = ${esc(JSON.stringify(data.value))}::jsonb`);
    }
    if (data.label !== undefined) {
      setParts.push(data.label === null ? "label = NULL" : `label = ${esc(data.label)}`);
    }
    if (data.description !== undefined) {
      setParts.push(data.description === null ? "description = NULL" : `description = ${esc(data.description)}`);
    }

    const setClause = setParts.join(", ");

    // sql.unsafe() exists in the real Postgres driver but NOT in the test mock.
    // Fall back to an identity function so the test mock can still be used.
    const sqlUnsafe = typeof (sql as unknown as Record<string, unknown>).unsafe === "function"
      ? (sql as unknown as { unsafe: (s: string) => any }).unsafe
      : (s: string) => s;

    const [row] = await sql<ISystemVariable[]>`
      UPDATE system_variables
      SET ${sqlUnsafe(setClause)}
      WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active = true
      RETURNING id, name, type, value, label, description, created_at, updated_at
    `;

    return row ?? null;
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const sql = await this.connectionManager.ensureSchema(tenantId);
    const result = await sql`
      UPDATE system_variables
      SET is_active = false, updated_at = NOW()
      WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active = true
      RETURNING id
    `;
    return result.length > 0;
  }
}
