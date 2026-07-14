import { Inject, Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import type {
  IntegrationManifest,
  ManifestValidationError,
} from "@yoizen/shared";
import { validateManifest } from "@yoizen/shared";
import { err, ok, type Result } from "../../lib/result";
import {
  type IManifestRevision,
  type IManifestRevisionRepository,
  MANIFEST_REVISION_REPOSITORY,
} from "./domain/manifest-revision.repository.interface";

@Injectable()
export class ManifestsService {
  private readonly logger = new PinoLoggerService(ManifestsService.name);

  constructor(
    @Inject(MANIFEST_REVISION_REPOSITORY)
    private readonly repository: IManifestRevisionRepository,
  ) {}

  /**
   * Runs the T01 schema + structural-rule validator (`@yoizen/shared`)
   * against an arbitrary input. Never throws — every failure surfaces as a
   * typed `ManifestValidationError[]`.
   */
  validate(
    input: unknown
  ): Result<IntegrationManifest, ManifestValidationError[]> {
    const result = validateManifest(input);
    if (!result.ok) {
      this.logger.warn(
        `Manifest validation failed with ${String(result.error.length)} error(s)`
      );
      return err(result.error);
    }
    this.logger.debug("Manifest validation passed");
    return ok(result.value);
  }

  /**
   * Validates `input`, confirms its `metadata.name` matches the route's
   * `name` param, then stores it as a new revision (never overwrites a
   * previous one). Tenant isolation is enforced by the tenant-scoped
   * connection manager used by the repository — the same (tenantId, name)
   * pair for two different tenants resolves to two different databases.
   */
  async putManifest(
    tenantId: string,
    name: string,
    input: unknown
  ): Promise<Result<IManifestRevision, ManifestValidationError[]>> {
    const validated = this.validate(input);
    if (!validated.ok) {
      return err(validated.error);
    }

    if (validated.value.metadata.name !== name) {
      this.logger.warn(
        `Manifest name mismatch tenant='${tenantId}' route='${name}' metadata='${validated.value.metadata.name}'`
      );
      return err([
        {
          path: "metadata.name",
          message: `metadata.name ('${validated.value.metadata.name}') must match the route parameter ('${name}')`,
        },
      ]);
    }

    const revision = await this.repository.createRevision(
      tenantId,
      name,
      validated.value
    );
    this.logger.log(
      `Manifest stored tenant='${tenantId}' name='${name}' revision=${String(
        revision.revision
      )}`
    );
    return ok(revision);
  }

  async getManifest(
    tenantId: string,
    name: string
  ): Promise<IManifestRevision | null> {
    const revision = await this.repository.getLatest(tenantId, name);
    this.logger.debug(
      `getManifest tenant='${tenantId}' name='${name}' found=${String(
        revision !== null
      )}`
    );
    return revision;
  }
}
