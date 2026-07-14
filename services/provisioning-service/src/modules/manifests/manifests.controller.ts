import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { TenantGuard, TenantId } from "@yoizen/database";
import { PinoLoggerService } from "@yoizen/observability";
import { ManifestsService } from "./manifests.service";

@Controller("manifests")
@UseGuards(TenantGuard)
export class ManifestsController {
  private readonly logger = new PinoLoggerService(ManifestsController.name);

  constructor(private readonly manifestsService: ManifestsService) {}

  @Post("validate")
  @HttpCode(HttpStatus.OK)
  validate(@TenantId() tenantId: string, @Body() body: unknown) {
    this.logger.log(`POST /manifests/validate tenant='${tenantId}'`);
    const result = this.manifestsService.validate(body);
    if (!result.ok) {
      return { valid: false, errors: result.error };
    }
    return { valid: true, errors: [] };
  }

  @Put(":name")
  async put(
    @TenantId() tenantId: string,
    @Param("name") name: string,
    @Body() body: unknown
  ) {
    this.logger.log(`PUT /manifests/${name} tenant='${tenantId}'`);
    const result = await this.manifestsService.putManifest(
      tenantId,
      name,
      body
    );
    if (!result.ok) {
      throw new HttpException(
        { valid: false, errors: result.error },
        HttpStatus.BAD_REQUEST
      );
    }
    return result.value;
  }

  @Get(":name")
  async get(@TenantId() tenantId: string, @Param("name") name: string) {
    this.logger.log(`GET /manifests/${name} tenant='${tenantId}'`);
    const revision = await this.manifestsService.getManifest(tenantId, name);
    if (!revision) {
      throw new HttpException(
        `No manifest named '${name}' found for this tenant`,
        HttpStatus.NOT_FOUND
      );
    }
    return revision;
  }
}
