import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Query,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AdminProxyService } from './admin-proxy.service';
import { UpsertConfigFileDto, DeployConfigFilesDto } from './admin.dto';
import type { TenantScopedRequest } from '../../types/yoizen-request';

@Controller('admin')
export class AdminConfigController {
  constructor(private readonly proxy: AdminProxyService) {}

  @Get('config-files')
  async listConfigFiles(
    @Req() req: TenantScopedRequest,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<object> {
    return this.proxy.proxy('GET', '/admin/config-files', req.tenantId, {
      limit,
      offset,
    });
  }

  @Get('config-files/file')
  async getConfigFileByPath(
    @Req() req: TenantScopedRequest,
    @Query('path') path?: string,
  ): Promise<object> {
    return this.proxy.proxy('GET', '/admin/config-files/file', req.tenantId, {
      path,
    });
  }

  @Put('config-files')
  async upsertConfigFile(
    @Req() req: TenantScopedRequest,
    @Body() body: UpsertConfigFileDto,
  ): Promise<object> {
    return this.proxy.proxy(
      'PUT',
      '/admin/config-files',
      req.tenantId,
      undefined,
      body,
    );
  }

  @Post('config-files/deploy')
  @HttpCode(HttpStatus.OK)
  async deployConfigFiles(
    @Req() req: TenantScopedRequest,
    @Body() body: DeployConfigFilesDto,
  ): Promise<object> {
    return this.proxy.proxy(
      'POST',
      '/admin/config-files/deploy',
      req.tenantId,
      undefined,
      body,
    );
  }

  @Get('runtime/status')
  async getRuntimeStatus(@Req() req: TenantScopedRequest): Promise<object> {
    return this.proxy.proxy('GET', '/admin/runtime/status', req.tenantId);
  }

  @Get('templates')
  async listTemplates(@Req() req: TenantScopedRequest): Promise<object> {
    return this.proxy.proxy('GET', '/admin/templates', req.tenantId);
  }
}
