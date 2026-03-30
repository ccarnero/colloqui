import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TENANT_HEADER } from '@yoizen/shared';
import { ConfigFilesService } from './config-files.service';
import {
  CreateConfigFileDto,
  UpdateConfigFileDto,
  ListConfigFilesQueryDto,
  GetConfigFileByPathQueryDto,
  DeployConfigFilesDto,
} from './config-files.dto';
import type { ConfigFile } from './config-files.repository';

@Controller('admin/config-files')
export class ConfigFilesController {
  constructor(private readonly service: ConfigFilesService) {}

  /**
   * Lista todos los config files.
   * GET /admin/config-files?limit=20&offset=0
   */
  @Get()
  async findAll(
    @Headers(TENANT_HEADER) tenantId: string,
    @Query() query: ListConfigFilesQueryDto,
  ): Promise<{ files: ConfigFile[]; total: number }> {
    return this.service.findAll(tenantId, {
      limit: query.limit,
      offset: query.offset,
    });
  }

  /**
   * Obtiene un config file por su path.
   * GET /admin/config-files/file?path=/config/app.yaml
   */
  @Get('file')
  async findByPath(
    @Headers(TENANT_HEADER) tenantId: string,
    @Query() query: GetConfigFileByPathQueryDto,
  ): Promise<ConfigFile> {
    return this.service.findByPath(tenantId, query.path);
  }

  /**
   * Crea o actualiza un config file.
   * PUT /admin/config-files
   * Si el path ya existe, actualiza y automaticamente incrementa la versión.
   * Si no existe, crea uno nuevo con versión 1.
   */
  @Put()
  async createOrUpdate(
    @Headers(TENANT_HEADER) tenantId: string,
    @Body() dto: CreateConfigFileDto,
  ): Promise<ConfigFile> {
    return this.service.createOrUpdate(tenantId, {
      name: dto.name,
      path: dto.path,
      content: dto.content,
      format: dto.format,
    });
  }

  /**
   * Deploy: sincroniza config files al runtime.
   * POST /admin/config-files/deploy
   * Emite evento NATS runtime.config.sync con todos los archivos activos.
   */
  @Post('deploy')
  @HttpCode(HttpStatus.OK)
  async deploy(
    @Headers(TENANT_HEADER) tenantId: string,
    @Body() dto: DeployConfigFilesDto,
  ): Promise<{ files: ConfigFile[]; eventEmitted: boolean }> {
    return this.service.deploy(tenantId, dto.deletePaths);
  }
}
