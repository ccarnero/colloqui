import { Inject, Injectable } from "@nestjs/common";
import type { Sql } from "@yoizen/database";
import { POSTGRES_SQL } from "../../providers/postgres.module";
import type { UpdateCanaryDto } from "./canary.dto";
import type {
  ICanaryDbRow,
  ICanaryRepository,
  IInsertCanaryDeploymentOptions,
  IRegisteredServiceDbRow,
} from "./canary.repository.interface";

@Injectable()
export class CanaryPostgresRepository implements ICanaryRepository {
  constructor(@Inject(POSTGRES_SQL) private readonly sql: Sql) {}

  async findProgressingCanary(serviceId: string) {
    return this.sql`
      SELECT id FROM canary_deployments
      WHERE service_id = ${serviceId} AND status = 'progressing'
    `;
  }

  async insertCanaryDeployment(
    options: IInsertCanaryDeploymentOptions,
  ): Promise<ICanaryDbRow[]> {
    const {
      id,
      serviceId,
      stableRevision,
      canaryRevision,
      percent,
    } = options;
    return this.sql`
      INSERT INTO canary_deployments
        (id, service_id, stable_revision, canary_revision, canary_percent, status)
      VALUES
        (${id}, ${serviceId}, ${stableRevision}, ${canaryRevision}, ${percent}, 'progressing')
      RETURNING *
    `;
  }

  async updateCanaryPercent(
    canaryId: string,
    dto: UpdateCanaryDto,
  ): Promise<ICanaryDbRow[]> {
    return this.sql`
      UPDATE canary_deployments SET
        canary_percent = ${dto.percent},
        updated_at = NOW()
      WHERE id = ${canaryId}
      RETURNING *
    `;
  }

  async updateCanaryPromoted(canaryId: string): Promise<ICanaryDbRow[]> {
    return this.sql`
      UPDATE canary_deployments SET
        canary_percent = 100,
        status = 'promoted',
        updated_at = NOW()
      WHERE id = ${canaryId}
      RETURNING *
    `;
  }

  async updateCanaryRolledBack(canaryId: string): Promise<ICanaryDbRow[]> {
    return this.sql`
      UPDATE canary_deployments SET
        canary_percent = 0,
        status = 'rolled_back',
        updated_at = NOW()
      WHERE id = ${canaryId}
      RETURNING *
    `;
  }

  async getLatestCanaryForService(serviceId: string): Promise<ICanaryDbRow[]> {
    return this.sql`
      SELECT * FROM canary_deployments
      WHERE service_id = ${serviceId}
      ORDER BY created_at DESC
      LIMIT 1
    `;
  }

  async findRegisteredService(
    serviceId: string,
    tenantId: string,
  ): Promise<IRegisteredServiceDbRow[]> {
    return this.sql`
      SELECT * FROM registered_services
      WHERE id = ${serviceId} AND tenant_id = ${tenantId}
    `;
  }

  async findActiveCanary(serviceId: string): Promise<ICanaryDbRow[]> {
    return this.sql`
      SELECT * FROM canary_deployments
      WHERE service_id = ${serviceId} AND status = 'progressing'
      ORDER BY created_at DESC
      LIMIT 1
    `;
  }
}
