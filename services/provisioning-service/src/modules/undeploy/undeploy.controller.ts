// `POST /manifests/:name/undeploy` — the declarative teardown verb
// (PENDIENTES/12-undeploy.spec.md T01). Same controller shape, guard and
// error mapping as `apply/apply.controller.ts`; only the verb differs.
//
// Status mapping:
//   200 — the run finished (including a run where every resource came back
//         `not_found`: undeploying an already-torn-down manifest is a
//         success, decision 6);
//   404 — no stored manifest by that name for this tenant. NOTE for the
//         gateway/SDK/CLI (T02): a SECOND full undeploy of the same manifest
//         lands here, because a fully successful run deletes the stored
//         record last (item 5). Decision 6's "safe to run twice" holds at the
//         resource level — nothing is re-deleted, nothing crashes — but the
//         caller must render this 404 as "already undeployed", not a failure;
//   409 — `undeploy_blocked` (decision 4 shared-resource guard),
//         `cycle_detected`, or a PARTIAL run — the same 409-with-typed-body
//         apply uses for a partial, so the caller can inspect progress and
//         re-run to resume.

import {
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { TenantGuard, TenantId } from "@yoizen/database";
import { PinoLoggerService } from "@yoizen/observability";
import { UndeployService } from "./undeploy.service";

@Controller("manifests")
@UseGuards(TenantGuard)
export class UndeployController {
  private readonly logger = new PinoLoggerService(UndeployController.name);

  constructor(private readonly undeployService: UndeployService) {}

  @Post(":name/undeploy")
  @HttpCode(HttpStatus.OK)
  async undeploy(@TenantId() tenantId: string, @Param("name") name: string) {
    this.logger.log(`POST /manifests/${name}/undeploy tenant='${tenantId}'`);

    const result = await this.undeployService.undeploy(tenantId, name);
    if (result.ok) {
      return result.value;
    }

    if (result.error.kind === "manifest_not_found") {
      throw new HttpException(
        `No manifest named '${name}' found for this tenant`,
        HttpStatus.NOT_FOUND
      );
    }

    throw new HttpException({ error: result.error }, HttpStatus.CONFLICT);
  }
}
