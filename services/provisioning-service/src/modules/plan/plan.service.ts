import { Inject, Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import { err, ok, type Result } from "../../lib/result";
import type { IManifestRevisionRepository } from "../manifests/domain/manifest-revision.repository.interface";
import { MANIFEST_REVISION_REPOSITORY } from "../manifests/domain/manifest-revision.repository.interface";
import type {
  CycleDetectedError,
  ManifestPlan,
} from "./domain/plan.interfaces";
import type { PlatformResourceClients } from "./domain/platform-resource-client.interface";
import { PLATFORM_RESOURCE_CLIENTS } from "./domain/platform-resource-client.interface";
import { buildManifestPlan } from "./lib/build-manifest-plan";

export interface ManifestNotFoundError {
  readonly kind: "manifest_not_found";
  readonly name: string;
}

export type PlanError = ManifestNotFoundError | CycleDetectedError;

@Injectable()
export class PlanService {
  private readonly logger = new PinoLoggerService(PlanService.name);

  constructor(
    @Inject(MANIFEST_REVISION_REPOSITORY)
    private readonly manifestRepository: IManifestRevisionRepository,
    @Inject(PLATFORM_RESOURCE_CLIENTS)
    private readonly clients: PlatformResourceClients
  ) {}

  /**
   * Loads the latest stored revision of `name` and runs the T03 read-only
   * resolver + planner against live platform state. Never mutates anything.
   */
  async plan(
    tenantId: string,
    name: string
  ): Promise<Result<ManifestPlan, PlanError>> {
    this.logger.log(`plan: loading manifest='${name}' tenant='${tenantId}'`);
    const revision = await this.manifestRepository.getLatest(tenantId, name);
    if (!revision) {
      this.logger.warn(
        `plan: no manifest named '${name}' found for tenant='${tenantId}'`
      );
      return err({ kind: "manifest_not_found", name });
    }

    const result = await buildManifestPlan(
      revision.manifest,
      tenantId,
      this.clients,
      this.logger
    );
    if (!result.ok) {
      return err(result.error);
    }
    return ok(result.value);
  }
}
