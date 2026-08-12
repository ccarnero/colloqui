// Postgres-backed `IKbChecksumRepository` (T06). Mirrors
// `manifest-revision.postgres.repository.ts`'s tenant-scoped-connection
// pattern — this is provisioning-service's OWN table
// (`kb_document_checksums`), never a write to agent-admin's schema.

import { Inject, Injectable } from "@nestjs/common";
import type { TenantConnectionManager } from "@yoizen/database";
import { PinoLoggerService } from "@yoizen/observability";
import { ProvisioningTenantConnectionManager } from "../../../providers/tenant-connection-manager";
import { TenantScopedPostgresRepository } from "../../../providers/tenant-scoped.repository";
import type {
  IKbChecksumRepository,
  KbDocumentChecksumRow,
} from "../domain/kb-checksum-repository.interface";
import type { IKbChecksumTeardownRepository } from "../domain/kb-checksum-teardown.repository.interface";

@Injectable()
export class KbChecksumPostgresRepository
  extends TenantScopedPostgresRepository
  implements IKbChecksumRepository, IKbChecksumTeardownRepository
{
  private readonly logger = new PinoLoggerService(
    KbChecksumPostgresRepository.name
  );

  constructor(
    @Inject(ProvisioningTenantConnectionManager)
    connectionManager: TenantConnectionManager
  ) {
    super(connectionManager);
  }

  async getChecksum(
    tenantId: string,
    manifestName: string,
    kbName: string,
    documentName: string
  ): Promise<KbDocumentChecksumRow | null> {
    const sql = await this.getSql(tenantId);
    const rows = await sql<
      { sha256: string; kbExternalId: string; documentExternalId: string }[]
    >`
      SELECT
        sha256,
        kb_external_id AS "kbExternalId",
        document_external_id AS "documentExternalId"
      FROM kb_document_checksums
      WHERE tenant_id = ${tenantId}
        AND manifest_name = ${manifestName}
        AND kb_name = ${kbName}
        AND document_name = ${documentName}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  async upsertChecksum(
    tenantId: string,
    manifestName: string,
    kbName: string,
    documentName: string,
    row: KbDocumentChecksumRow
  ): Promise<void> {
    const sql = await this.getSql(tenantId);
    await sql`
      INSERT INTO kb_document_checksums (
        tenant_id, manifest_name, kb_name, document_name,
        sha256, kb_external_id, document_external_id, updated_at
      ) VALUES (
        ${tenantId}, ${manifestName}, ${kbName}, ${documentName},
        ${row.sha256}, ${row.kbExternalId}, ${row.documentExternalId}, NOW()
      )
      ON CONFLICT (tenant_id, manifest_name, kb_name, document_name)
      DO UPDATE SET
        sha256 = EXCLUDED.sha256,
        kb_external_id = EXCLUDED.kb_external_id,
        document_external_id = EXCLUDED.document_external_id,
        updated_at = NOW()
    `;
    this.logger.log(
      `upsertChecksum: tenant='${tenantId}' manifest='${manifestName}' kb='${kbName}' document='${documentName}' sha256='${row.sha256.slice(0, 12)}...'`
    );
  }

  /**
   * `IKbChecksumTeardownRepository` — undeploy's cleanup of provisioning's
   * OWN state. Scoped to (tenant, manifest): another manifest's rows for the
   * same kb/document names are never touched.
   */
  async deleteByManifest(
    tenantId: string,
    manifestName: string
  ): Promise<number> {
    const sql = await this.getSql(tenantId);
    const deleted = await sql<{ documentName: string }[]>`
      DELETE FROM kb_document_checksums
      WHERE tenant_id = ${tenantId}
        AND manifest_name = ${manifestName}
      RETURNING document_name AS "documentName"
    `;
    this.logger.log(
      `deleteByManifest: tenant='${tenantId}' manifest='${manifestName}' rowsDeleted=${String(deleted.length)}`
    );
    return deleted.length;
  }
}
