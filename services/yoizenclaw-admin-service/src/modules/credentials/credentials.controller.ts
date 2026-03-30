import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TENANT_HEADER } from '@yoizen/shared';
import { CredentialsService } from './credentials.service';
import {
  CreateCredentialDto,
  UpdateCredentialDto,
  ListCredentialsQueryDto,
  RotateCredentialDto,
} from './credentials.dto';
import type { CredentialWithoutValue } from './credentials.repository';

@Controller('admin/credentials')
export class CredentialsController {
  constructor(private readonly service: CredentialsService) {}

  /**
   * Lista todas las credenciales con filtros opcionales.
   * GET /admin/credentials?type=api_key&limit=20&offset=0
   * NUNCA retorna el campo value por seguridad.
   */
  @Get()
  async findAll(
    @Headers(TENANT_HEADER) tenantId: string,
    @Query() query: ListCredentialsQueryDto,
  ): Promise<{ credentials: CredentialWithoutValue[]; total: number }> {
    return this.service.findAll(tenantId, {
      type: query.type,
      is_active: query.is_active,
      limit: query.limit,
      offset: query.offset,
    });
  }

  /**
   * Obtiene una credencial por su ID.
   * GET /admin/credentials/:id
   * NUNCA retorna el campo value por seguridad.
   */
  @Get(':id')
  async findById(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param('id') id: string,
  ): Promise<CredentialWithoutValue> {
    return this.service.findById(tenantId, id);
  }

  /**
   * Crea una nueva credencial.
   * POST /admin/credentials
   * FIXME: Implementar cifrado con KMS/Vault antes de producción
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Headers(TENANT_HEADER) tenantId: string,
    @Body() dto: CreateCredentialDto,
  ): Promise<CredentialWithoutValue> {
    return this.service.create(tenantId, {
      name: dto.name,
      type: dto.type,
      value: dto.value,
      metadata: dto.metadata,
      expires_at: dto.expires_at,
      is_active: dto.is_active,
    });
  }

  /**
   * Actualiza una credencial existente.
   * PUT /admin/credentials/:id
   * Si se actualiza el value, se emite evento credential.rotated.
   * FIXME: Implementar cifrado con KMS/Vault antes de producción
   */
  @Put(':id')
  async update(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCredentialDto,
  ): Promise<CredentialWithoutValue> {
    return this.service.update(tenantId, id, {
      name: dto.name,
      type: dto.type,
      value: dto.value,
      metadata: dto.metadata,
      expires_at: dto.expires_at,
      is_active: dto.is_active,
    });
  }

  /**
   * Elimina (soft delete) una credencial.
   * DELETE /admin/credentials/:id
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.service.delete(tenantId, id);
  }

  /**
   * Rota el valor de una credencial.
   * PUT /admin/credentials/:id/rotate
   * Emite evento credential.rotated al completar.
   * FIXME: Implementar cifrado con KMS/Vault antes de producción
   */
  @Put(':id/rotate')
  async rotate(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param('id') id: string,
    @Body() dto: RotateCredentialDto,
  ): Promise<CredentialWithoutValue> {
    return this.service.rotate(tenantId, id, dto.new_value, dto.new_expires_at);
  }
}
