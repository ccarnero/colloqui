import { Controller, Get, Headers, HttpCode, HttpStatus } from '@nestjs/common';
import { TENANT_HEADER } from '@yoizen/shared';
import { RuntimeService } from './runtime.service';

interface RuntimeStatusResponse {
  configured: boolean;
  connected_runtimes: string[];
  last_sync_at?: string;
}

/**
 * Controller para endpoints de estado del runtime.
 * Base path: /admin/runtime
 */
@Controller('admin/runtime')
export class RuntimeController {
  constructor(private readonly runtimeService: RuntimeService) {}

  /**
   * Obtiene el estado del runtime para un tenant.
   * GET /admin/runtime/status
   *
   * Retorna información sobre:
   * - Si el runtime está configurado
   * - Runtimes conectados
   * - Última sincronización
   */
  @Get('status')
  @HttpCode(HttpStatus.OK)
  async getStatus(
    @Headers(TENANT_HEADER) tenantId: string,
  ): Promise<RuntimeStatusResponse> {
    return this.runtimeService.getStatus(tenantId);
  }
}
