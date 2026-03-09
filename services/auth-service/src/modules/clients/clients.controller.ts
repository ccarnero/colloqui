import { Body, Controller, Delete, Get, Headers, Param, Post } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './client.dto';
import { TENANT_HEADER } from '@yoizen/shared';

@Controller('auth/clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Post()
  async create(@Body() dto: CreateClientDto) {
    return this.clientsService.create(dto.name, dto.scope);
  }

  @Get()
  async list(@Headers(TENANT_HEADER) tenantId: string | undefined) {
    return this.clientsService.list(tenantId);
  }

  @Delete(':id')
  async revoke(@Param('id') id: string) {
    await this.clientsService.revoke(id);
    return { deleted: true };
  }
}
