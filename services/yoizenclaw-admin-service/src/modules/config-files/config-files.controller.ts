import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from "@nestjs/common";
import { ConfigFilesService } from "./config-files.service";
import {
  CreateConfigFileDto,
  ListConfigFilesQueryDto,
  GetConfigFileByPathQueryDto,
  DeployConfigFilesDto,
} from "./config-files.dto";
import type { IConfigFile } from "./config-files.repository";
import { TenantGuard } from "../../guards/tenant.guard";
import { TenantId } from "../../providers/tenant.decorator";

@Controller("admin/config-files")
@UseGuards(TenantGuard)
export class ConfigFilesController {
  constructor(private readonly service: ConfigFilesService) {}

  /**
   * Lists config files.
   * GET /admin/config-files?limit=20&offset=0
   */
  @Get()
  async findAll(
    @TenantId() tenantId: string,
    @Query() query: ListConfigFilesQueryDto,
  ): Promise<{ files: IConfigFile[]; total: number }> {
    return this.service.findAll(tenantId, {
      limit: query.limit,
      offset: query.offset,
    });
  }

  /**
   * Returns a config file by path.
   * GET /admin/config-files/file?path=/config/app.yaml
   */
  @Get("file")
  async findByPath(
    @TenantId() tenantId: string,
    @Query() query: GetConfigFileByPathQueryDto,
  ): Promise<IConfigFile> {
    return this.service.findByPath(tenantId, query.path);
  }

  /**
   * Creates or updates a config file.
   * PUT /admin/config-files
   * If the path exists, updates and bumps version.
   * If not, creates a new file at version 1.
   */
  @Put()
  async createOrUpdate(
    @TenantId() tenantId: string,
    @Body() dto: CreateConfigFileDto,
  ): Promise<IConfigFile> {
    return this.service.createOrUpdate(tenantId, {
      name: dto.name,
      path: dto.path,
      content: dto.content,
      format: dto.format,
    });
  }

  /**
   * Deploy: syncs config files to runtime.
   * POST /admin/config-files/deploy
   * Emits NATS runtime.config.sync with all active files.
   */
  @Post("deploy")
  @HttpCode(HttpStatus.OK)
  async deploy(
    @TenantId() tenantId: string,
    @Body() dto: DeployConfigFilesDto,
  ): Promise<{ files: IConfigFile[]; eventEmitted: boolean }> {
    return this.service.deploy(tenantId, dto.deletePaths);
  }
}
