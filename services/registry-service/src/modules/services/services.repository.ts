import { Inject, Injectable } from "@nestjs/common";
import type { Sql } from "postgres";
import { POSTGRES_SQL } from "../../providers/postgres.provider";
import type { RegisterServiceDto } from "./services.dto";
import { asPostgresJsonValue } from "../../utils/postgres-json";

/** Raw row from `registered_services` (subset used by ServicesService). */
export type IRegisteredServiceRow = Record<string, unknown>;

/** Options for inserting a registered service row. */
export interface IInsertRegisteredServiceOptions {
  id: string;
  tenantId: string;
  dto: RegisterServiceDto;
  port: number;
  minScale: number;
  maxScale: number;
  concurrencyTarget: number;
  envVars: Record<string, string>;
  ksvcName: string;
  ns: string;
}

/** Options for updating a registered service row. */
export interface IUpdateRegisteredServiceOptions {
  id: string;
  tenantId: string;
  image: string;
  port: number;
  minScale: number;
  maxScale: number;
  concurrencyTarget: number;
  envVars: Record<string, string>;
}

@Injectable()
export class ServicesRepository {
  constructor(@Inject(POSTGRES_SQL) private readonly sql: Sql) {}

  async findIdByTenantAndName(
    tenantId: string,
    name: string,
  ): Promise<IRegisteredServiceRow[]> {
    return this.sql`
      SELECT id FROM registered_services
      WHERE tenant_id = ${tenantId} AND name = ${name}
    `;
  }

  async insertRegisteredService(
    options: IInsertRegisteredServiceOptions,
  ): Promise<IRegisteredServiceRow[]> {
    const {
      id,
      tenantId,
      dto,
      port,
      minScale,
      maxScale,
      concurrencyTarget,
      envVars,
      ksvcName,
      ns,
    } = options;
    return this.sql`
      INSERT INTO registered_services
        (id, tenant_id, name, image, port, min_scale, max_scale,
         concurrency_target, env_vars, status, knative_name, namespace)
      VALUES
        (${id}, ${tenantId}, ${dto.name}, ${dto.image}, ${port},
         ${minScale}, ${maxScale}, ${concurrencyTarget},
         ${this.sql.json(asPostgresJsonValue(envVars))}, 'active', ${ksvcName}, ${ns})
      RETURNING *
    `;
  }

  async listByTenant(tenantId: string): Promise<IRegisteredServiceRow[]> {
    return this.sql`
      SELECT * FROM registered_services
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at DESC
    `;
  }

  async findByIdAndTenant(
    id: string,
    tenantId: string,
  ): Promise<IRegisteredServiceRow[]> {
    return this.sql`
      SELECT * FROM registered_services
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
  }

  async updateRegisteredService(
    options: IUpdateRegisteredServiceOptions,
  ): Promise<IRegisteredServiceRow[]> {
    const {
      id,
      tenantId,
      image,
      port,
      minScale,
      maxScale,
      concurrencyTarget,
      envVars,
    } = options;
    return this.sql`
      UPDATE registered_services SET
        image = ${image},
        port = ${port},
        min_scale = ${minScale},
        max_scale = ${maxScale},
        concurrency_target = ${concurrencyTarget},
        env_vars = ${this.sql.json(asPostgresJsonValue(envVars))},
        updated_at = NOW()
      WHERE id = ${id} AND tenant_id = ${tenantId}
      RETURNING *
    `;
  }

  async deleteById(id: string): Promise<void> {
    await this.sql`DELETE FROM registered_services WHERE id = ${id}`;
  }

  async selectKnativeMetaForRevision(
    id: string,
    tenantId: string,
  ): Promise<IRegisteredServiceRow[]> {
    return this.sql`
      SELECT knative_name, namespace FROM registered_services
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
  }
}
