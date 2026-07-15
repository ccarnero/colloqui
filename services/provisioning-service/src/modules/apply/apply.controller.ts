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
import { ApplyService } from "./apply.service";

@Controller("manifests")
@UseGuards(TenantGuard)
export class ApplyController {
  private readonly logger = new PinoLoggerService(ApplyController.name);

  constructor(private readonly applyService: ApplyService) {}

  @Post(":name/apply")
  @HttpCode(HttpStatus.OK)
  async apply(@TenantId() tenantId: string, @Param("name") name: string) {
    this.logger.log(`POST /manifests/${name}/apply tenant='${tenantId}'`);
    const result = await this.applyService.apply(tenantId, name);
    if (result.ok) {
      return result.value;
    }

    if (result.error.kind === "manifest_not_found") {
      throw new HttpException(
        `No manifest named '${name}' found for this tenant`,
        HttpStatus.NOT_FOUND
      );
    }
    if (result.error.kind === "cycle_detected") {
      throw new HttpException({ error: result.error }, HttpStatus.CONFLICT);
    }
    // Partial-failure apply result: 409 with applied/pending so the caller
    // can inspect progress and re-apply to resume.
    throw new HttpException({ error: result.error }, HttpStatus.CONFLICT);
  }
}
