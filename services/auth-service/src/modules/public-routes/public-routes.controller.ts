import { Body, Controller, Delete, Get, Headers, Param, Post } from '@nestjs/common';
import { PublicRoutesService } from './public-routes.service';
import { CreatePublicRouteDto } from './public-route.dto';
import { TENANT_HEADER } from '@yoizen/shared';

@Controller('auth/public-routes')
export class PublicRoutesController {
  constructor(private readonly publicRoutesService: PublicRoutesService) {}

  @Post()
  async create(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Body() dto: CreatePublicRouteDto,
  ) {
    return this.publicRoutesService.create(dto.method, dto.path_pattern, dto.scope, tenantId);
  }

  @Get()
  async list(@Headers(TENANT_HEADER) tenantId: string | undefined) {
    return this.publicRoutesService.list(tenantId);
  }

  @Delete(':id')
  async remove(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Param('id') id: string,
  ) {
    await this.publicRoutesService.remove(id, tenantId);
    return { deleted: true };
  }
}
