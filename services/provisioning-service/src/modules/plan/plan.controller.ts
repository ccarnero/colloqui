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
import { PlanService } from "./plan.service";

@Controller("manifests")
@UseGuards(TenantGuard)
export class PlanController {
  private readonly logger = new PinoLoggerService(PlanController.name);

  constructor(private readonly planService: PlanService) {}

  @Post(":name/plan")
  @HttpCode(HttpStatus.OK)
  async plan(@TenantId() tenantId: string, @Param("name") name: string) {
    this.logger.log(`POST /manifests/${name}/plan tenant='${tenantId}'`);
    const result = await this.planService.plan(tenantId, name);
    if (!result.ok) {
      if (result.error.kind === "manifest_not_found") {
        throw new HttpException(
          `No manifest named '${name}' found for this tenant`,
          HttpStatus.NOT_FOUND
        );
      }
      // cycle_detected — typed 409, never a hang or a 500.
      throw new HttpException({ error: result.error }, HttpStatus.CONFLICT);
    }
    return result.value;
  }
}
