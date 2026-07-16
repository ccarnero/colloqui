import { Inject, Injectable, Optional } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import { err, ok, type Result } from "../../lib/result";
import type { IKbChecksumRepository } from "../kb/domain/kb-checksum-repository.interface";
import {
  createInMemoryKbChecksumRepository,
  KB_CHECKSUM_REPOSITORY,
} from "../kb/domain/kb-checksum-repository.interface";
import type { IManifestRevisionRepository } from "../manifests/domain/manifest-revision.repository.interface";
import { MANIFEST_REVISION_REPOSITORY } from "../manifests/domain/manifest-revision.repository.interface";
import type {
  CycleDetectedError,
  ManifestPlan,
} from "./domain/plan.interfaces";
import type { PlatformResourceClients } from "./domain/platform-resource-client.interface";
import { PLATFORM_RESOURCE_CLIENTS } from "./domain/platform-resource-client.interface";
import type { RouteCollisionChecker } from "./domain/route-collision-checker.interface";
import {
  NOOP_ROUTE_COLLISION_CHECKER,
  ROUTE_COLLISION_CHECKER,
} from "./domain/route-collision-checker.interface";
import type { SecretExistenceChecker } from "./domain/secret-existence-checker.interface";
import {
  NOOP_SECRET_EXISTENCE_CHECKER,
  SECRET_EXISTENCE_CHECKER,
} from "./domain/secret-existence-checker.interface";
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
    private readonly clients: PlatformResourceClients,
    @Optional()
    @Inject(SECRET_EXISTENCE_CHECKER)
    private readonly secretsChecker: SecretExistenceChecker = NOOP_SECRET_EXISTENCE_CHECKER,
    // T06: falls back to an in-memory (never-applied) checksum lookup when
    // not wired — every manifest reads as "first apply" in that case, same
    // as the pre-T06 behavior of reporting no KB plan data at all.
    @Optional()
    @Inject(KB_CHECKSUM_REPOSITORY)
    private readonly kbChecksums: IKbChecksumRepository = createInMemoryKbChecksumRepository(),
    // T05, gap 5, decision 6 ruling — real checker wired in `plan.module.ts`;
    // falls back to reporting no known live routes (no collision detected)
    // when not injected.
    @Optional()
    @Inject(ROUTE_COLLISION_CHECKER)
    private readonly routeCollisionChecker: RouteCollisionChecker = NOOP_ROUTE_COLLISION_CHECKER
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

    // manual-loops/provisioning-manifest-gaps-2.md T01, gap 1 — log the
    // manifest's own `kind` at debug level; a `LibraryManifest` planned here
    // may legitimately carry zero channels/agents/workflows.
    this.logger.debug(
      `plan: manifest='${name}' tenant='${tenantId}' kind='${revision.manifest.kind}'`
    );

    // T06: read this service's own checksum bookkeeping (never a mutation)
    // so buildManifestPlan can decide create/reembed/skip per KB document.
    // A read failure (e.g. a transient DB error) must NEVER blank the KB
    // plan or 500 the endpoint — it degrades to "no stored checksum", i.e.
    // the document reads as a fresh `create` and is counted toward the
    // re-embed estimate. Plan stays read-only and always returns the KB
    // cost estimate the caller relies on.
    const knowledgeBases = revision.manifest.spec.knowledgeBases ?? [];
    const checksumRows = await Promise.all(
      knowledgeBases.flatMap((kb) =>
        kb.documents.map(async (doc) => {
          try {
            const row = await this.kbChecksums.getChecksum(
              tenantId,
              name,
              kb.name,
              doc.name
            );
            return {
              kbName: kb.name,
              documentName: doc.name,
              sha256: row?.sha256,
            };
          } catch (cause) {
            this.logger.warn(
              `plan: KB checksum read failed kb='${kb.name}' document='${doc.name}' tenant='${tenantId}' — treating as never-applied (create): ${cause instanceof Error ? cause.message : String(cause)}`
            );
            return {
              kbName: kb.name,
              documentName: doc.name,
              sha256: undefined,
            };
          }
        })
      )
    );
    const checksumLookup = (kbName: string, documentName: string) =>
      checksumRows.find(
        (r) => r.kbName === kbName && r.documentName === documentName
      )?.sha256;

    const result = await buildManifestPlan(
      revision.manifest,
      tenantId,
      this.clients,
      this.logger,
      this.secretsChecker,
      checksumLookup,
      this.routeCollisionChecker
    );
    if (!result.ok) {
      return err(result.error);
    }
    return ok(result.value);
  }
}
