import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { RoutesService } from './routes.service';
import { CreateRouteDto } from './routes.dto';
import { TENANT_HEADER } from '@yoizen/shared';

@Controller()
export class RoutesController {
  constructor(private readonly routesService: RoutesService) {}

  @Post('services/:serviceId/routes')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param('serviceId') serviceId: string,
    @Body() dto: CreateRouteDto,
  ) {
    return this.routesService.create(tenantId, serviceId, dto);
  }

  @Get('services/:serviceId/routes')
  async listForService(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param('serviceId') serviceId: string,
  ) {
    return this.routesService.listForService(tenantId, serviceId);
  }

  @Delete('services/:serviceId/routes/:routeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param('serviceId') serviceId: string,
    @Param('routeId') routeId: string,
  ) {
    return this.routesService.remove(tenantId, serviceId, routeId);
  }

  @Get('routes')
  async discover() {
    return this.routesService.discover();
  }
}
