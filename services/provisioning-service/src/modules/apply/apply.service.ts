import { Inject, Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import { err, ok, type Result } from "../../lib/result";
import {
  type IManifestRevisionRepository,
  MANIFEST_REVISION_REPOSITORY,
} from "../manifests/domain/manifest-revision.repository.interface";
import type { CycleDetectedError } from "../plan/domain/plan.interfaces";
import type { PlatformResourceClients } from "../plan/domain/platform-resource-client.interface";
import { PLATFORM_RESOURCE_CLIENTS } from "../plan/domain/platform-resource-client.interface";
import { buildManifestPlan } from "../plan/lib/build-manifest-plan";
import type {
  ManifestApplyFailure,
  ManifestApplySuccess,
} from "./domain/apply.interfaces";
import type { IApplyEventPublisher } from "./domain/apply-event-publisher.interface";
import { APPLY_EVENT_PUBLISHER } from "./domain/apply-event-publisher.interface";
import type { PlatformResourceWriters } from "./domain/platform-resource-writer.interface";
import { PLATFORM_RESOURCE_WRITERS } from "./domain/platform-resource-writer.interface";
import { applyManifestPlan } from "./lib/apply-manifest";

export interface ManifestNotFoundApplyError {
  readonly kind: "manifest_not_found";
  readonly name: string;
}

export type ApplyError =
  | ManifestNotFoundApplyError
  | CycleDetectedError
  | ManifestApplyFailure;

@Injectable()
export class ApplyService {
  private readonly logger = new PinoLoggerService(ApplyService.name);

  constructor(
    @Inject(MANIFEST_REVISION_REPOSITORY)
    private readonly manifestRepository: IManifestRevisionRepository,
    @Inject(PLATFORM_RESOURCE_CLIENTS)
    private readonly clients: PlatformResourceClients,
    @Inject(PLATFORM_RESOURCE_WRITERS)
    private readonly writers: PlatformResourceWriters,
    @Inject(APPLY_EVENT_PUBLISHER)
    private readonly events: IApplyEventPublisher
  ) {}

  /**
   * Loads the latest stored revision of `name`, builds a FRESH T03 plan
   * against current live state (so a re-apply after a partial failure
   * always resumes from reality, never a stale cached plan), then executes
   * the T04 apply engine. Never mutates anything the planner did not
   * already mark `create`/`update`.
   */
  async apply(
    tenantId: string,
    name: string
  ): Promise<Result<ManifestApplySuccess, ApplyError>> {
    this.logger.log(`apply: loading manifest='${name}' tenant='${tenantId}'`);
    const revision = await this.manifestRepository.getLatest(tenantId, name);
    if (!revision) {
      this.logger.warn(
        `apply: no manifest named '${name}' found for tenant='${tenantId}'`
      );
      return err({ kind: "manifest_not_found", name });
    }

    const planResult = await buildManifestPlan(
      revision.manifest,
      tenantId,
      this.clients
    );
    if (!planResult.ok) {
      return err(planResult.error);
    }

    const result = await applyManifestPlan({
      manifest: revision.manifest,
      tenantId,
      plan: planResult.value,
      revision: revision.revision,
      writers: this.writers,
      events: this.events,
    });

    if (!result.ok) {
      return err(result.error);
    }
    return ok(result.value);
  }
}
