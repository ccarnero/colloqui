import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  Req,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AdminProxyService } from './admin-proxy.service';
import {
  CreateCredentialDto,
  UpdateCredentialDto,
  RotateCredentialDto,
} from './admin.dto';
import type { TenantScopedRequest } from '../../types/yoizen-request';

@Controller('admin/credentials')
export class AdminCredentialsController {
  constructor(private readonly proxy: AdminProxyService) {}

  @Get('providers')
  async getProviders(
    @Req() req: TenantScopedRequest,
  ): Promise<object> {
    return this.proxy.proxyRequest('GET', '/admin/credentials/providers', req);
  }

  @Get()
  async listCredentials(
    @Req() req: TenantScopedRequest,
    @Query('provider') provider?: string,
    @Query('is_active') isActive?: string,
    @Query('sync_status') syncStatus?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<object> {
    return this.proxy.proxyRequest('GET', '/admin/credentials', req, {
      query: { provider, is_active: isActive, sync_status: syncStatus, limit, offset },
    });
  }

  @Get(':id')
  async getCredential(
    @Req() req: TenantScopedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<object> {
    return this.proxy.proxyRequest('GET', `/admin/credentials/${id}`, req);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createCredential(
    @Req() req: TenantScopedRequest,
    @Body() body: CreateCredentialDto,
  ): Promise<object> {
    return this.proxy.proxyRequest('POST', '/admin/credentials', req, { body });
  }

  @Put(':id')
  async updateCredential(
    @Req() req: TenantScopedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCredentialDto,
  ): Promise<object> {
    return this.proxy.proxyRequest('PUT', `/admin/credentials/${id}`, req, { body });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCredential(
    @Req() req: TenantScopedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.proxy.proxyRequest('DELETE', `/admin/credentials/${id}`, req);
  }

  @Put(':id/rotate')
  async rotateCredential(
    @Req() req: TenantScopedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RotateCredentialDto,
  ): Promise<object> {
    return this.proxy.proxyRequest('PUT', `/admin/credentials/${id}/rotate`, req, { body });
  }

  @Post('sync')
  @HttpCode(HttpStatus.ACCEPTED)
  async syncCredentials(
    @Req() req: TenantScopedRequest,
    @Body() body?: object,
  ): Promise<object> {
    return this.proxy.proxyRequest('POST', '/admin/credentials/sync', req, { body });
  }
}
