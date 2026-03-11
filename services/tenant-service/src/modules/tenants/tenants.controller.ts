import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  TenantsService,
  type TenantDetail,
  type TenantSummary,
} from './tenants.service';
import { CreateTenantDto, UpdateTenantDto } from './tenant.dto';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateTenantDto): Promise<TenantDetail> {
    return this.tenantsService.createTenant(dto.name, dto.configuration);
  }

  @Get()
  async list(): Promise<TenantSummary[]> {
    return this.tenantsService.listTenants();
  }

  @Get(':name')
  async get(@Param('name') name: string): Promise<TenantDetail> {
    return this.tenantsService.getTenant(name);
  }

  @Patch(':name')
  async update(
    @Param('name') name: string,
    @Body() dto: UpdateTenantDto,
  ): Promise<TenantDetail> {
    return this.tenantsService.updateTenant(name, dto.configuration);
  }

  @Delete(':name')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('name') name: string): Promise<void> {
    return this.tenantsService.deleteTenant(name);
  }
}
