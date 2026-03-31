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

interface TenantRequest extends Request {
  tenantId: string;
}

@Controller('admin/credentials')
export class AdminCredentialsController {
  constructor(private readonly proxy: AdminProxyService) {}

  @Get()
  async listCredentials(
    @Req() req: TenantRequest,
    @Query('type') type?: string,
    @Query('is_active') isActive?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<object> {
    return this.proxy.proxy('GET', '/admin/credentials', req.tenantId, {
      type,
      is_active: isActive,
      limit,
      offset,
    });
  }

  @Get(':id')
  async getCredential(
    @Req() req: TenantRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<object> {
    return this.proxy.proxy('GET', `/admin/credentials/${id}`, req.tenantId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createCredential(
    @Req() req: TenantRequest,
    @Body() body: CreateCredentialDto,
  ): Promise<object> {
    return this.proxy.proxy(
      'POST',
      '/admin/credentials',
      req.tenantId,
      undefined,
      body,
    );
  }

  @Put(':id')
  async updateCredential(
    @Req() req: TenantRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCredentialDto,
  ): Promise<object> {
    return this.proxy.proxy(
      'PUT',
      `/admin/credentials/${id}`,
      req.tenantId,
      undefined,
      body,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCredential(
    @Req() req: TenantRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.proxy.proxy('DELETE', `/admin/credentials/${id}`, req.tenantId);
  }

  @Put(':id/rotate')
  async rotateCredential(
    @Req() req: TenantRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RotateCredentialDto,
  ): Promise<object> {
    return this.proxy.proxy(
      'PUT',
      `/admin/credentials/${id}/rotate`,
      req.tenantId,
      undefined,
      body,
    );
  }
}
