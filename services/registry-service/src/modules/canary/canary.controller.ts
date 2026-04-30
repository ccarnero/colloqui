import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { CanaryService } from "./canary.service";
import { StartCanaryDto, UpdateCanaryDto } from "./canary.dto";
import { TENANT_HEADER } from "@yoizen/shared";

@Controller("services/:serviceId/canary")
export class CanaryController {
  constructor(private readonly canaryService: CanaryService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async start(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param("serviceId") serviceId: string,
    @Body() dto: StartCanaryDto,
  ) {
    return this.canaryService.start(tenantId, serviceId, dto);
  }

  @Patch()
  async updatePercent(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param("serviceId") serviceId: string,
    @Body() dto: UpdateCanaryDto,
  ) {
    return this.canaryService.updatePercent(tenantId, serviceId, dto);
  }

  @Post("promote")
  @HttpCode(HttpStatus.OK)
  async promote(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param("serviceId") serviceId: string,
  ) {
    return this.canaryService.promote(tenantId, serviceId);
  }

  @Post("rollback")
  @HttpCode(HttpStatus.OK)
  async rollback(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param("serviceId") serviceId: string,
  ) {
    return this.canaryService.rollback(tenantId, serviceId);
  }

  @Get()
  async status(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param("serviceId") serviceId: string,
  ) {
    return this.canaryService.getStatus(tenantId, serviceId);
  }
}
