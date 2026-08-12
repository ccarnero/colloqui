import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { TenantConnectionManager } from "@yoizen/database";
import { PinoLoggerService } from "@yoizen/observability";
import type { IntegrationManifest, JsonValue } from "@yoizen/shared";
import { ProvisioningTenantConnectionManager } from "../../../providers/tenant-connection-manager";
import { TenantScopedPostgresRepository } from "../../../providers/tenant-scoped.repository";
import type {
  IManifestRevision,
  IManifestRevisionRepository,
} from "../domain/manifest-revision.repository.interface";
import type { IManifestTeardownRepository } from "../domain/manifest-teardown.repository.interface";

const MANIFEST_REVISION_COLUMNS = [
  "id",
  'tenant_id AS "tenantId"',
  "name",
  "revision",
  "manifest",
  'created_at AS "createdAt"',
].join(", ");

@Injectable()
export class ManifestRevisionPostgresRepository
  extends TenantScopedPostgresRepository
  implements IManifestRevisionRepository, IManifestTeardownRepository
{
  private readonly logger = new PinoLoggerService(
    ManifestRevisionPostgresRepository.name
  );

  constructor(
    @Inject(ProvisioningTenantConnectionManager)
    connectionManager: TenantConnectionManager,
  ) {
    super(connectionManager);
  }

  async getLatest(
    tenantId: string,
    name: string
  ): Promise<IManifestRevision | null> {
    const sql = await this.getSql(tenantId);

    const results = await sql<IManifestRevision[]>`
      SELECT ${sql.unsafe(MANIFEST_REVISION_COLUMNS)}
      FROM manifest_revisions
      WHERE tenant_id = ${tenantId} AND name = ${name}
      ORDER BY revision DESC
      LIMIT 1
    `;

    const latest = results[0] ?? null;
    this.logger.debug(
      `getLatest tenant='${tenantId}' name='${name}' found=${String(
        latest !== null
      )}`
    );
    return latest;
  }

  /**
   * `IManifestTeardownRepository` — the latest revision of every stored
   * manifest, one row per name (`DISTINCT ON` over the same
   * `(tenant_id, name, revision DESC)` index `getLatest` uses).
   */
  async listLatestManifests(tenantId: string): Promise<IManifestRevision[]> {
    const sql = await this.getSql(tenantId);

    const results = await sql<IManifestRevision[]>`
      SELECT DISTINCT ON (name) ${sql.unsafe(MANIFEST_REVISION_COLUMNS)}
      FROM manifest_revisions
      WHERE tenant_id = ${tenantId}
      ORDER BY name, revision DESC
    `;

    this.logger.debug(
      `listLatestManifests tenant='${tenantId}' manifests=${String(results.length)}`
    );
    return results;
  }

  /**
   * `IManifestTeardownRepository` — drops EVERY revision of `name`. Returns
   * the row count so undeploy can report "the manifest record was already
   * gone" instead of failing (decision 6, idempotent).
   */
  async deleteManifest(tenantId: string, name: string): Promise<number> {
    const sql = await this.getSql(tenantId);

    const deleted = await sql<{ id: string }[]>`
      DELETE FROM manifest_revisions
      WHERE tenant_id = ${tenantId} AND name = ${name}
      RETURNING id
    `;

    this.logger.log(
      `deleteManifest tenant='${tenantId}' name='${name}' revisionsDeleted=${String(deleted.length)}`
    );
    return deleted.length;
  }

  async createRevision(
    tenantId: string,
    name: string,
    manifest: IntegrationManifest
  ): Promise<IManifestRevision> {
    const sql = await this.getSql(tenantId);
    const id = randomUUID();

    const created = await sql.begin(async (tx) => {
      const [{ nextRevision }] = await tx<{ nextRevision: number }[]>`
        SELECT COALESCE(MAX(revision), 0) + 1 AS "nextRevision"
        FROM manifest_revisions
        WHERE tenant_id = ${tenantId} AND name = ${name}
      `;

      const results = await tx<IManifestRevision[]>`
        INSERT INTO manifest_revisions (
          id,
          tenant_id,
          name,
          revision,
          manifest,
          created_at
        ) VALUES (
          ${id},
          ${tenantId},
          ${name},
          ${nextRevision},
          ${sql.json(manifest as unknown as JsonValue)},
          NOW()
        )
        RETURNING ${sql.unsafe(MANIFEST_REVISION_COLUMNS)}
      `;

      return results[0];
    });

    this.logger.log(
      `Stored manifest revision tenant='${tenantId}' name='${name}' revision=${String(
        created.revision
      )}`
    );
    return created;
  }
}
