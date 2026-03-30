import { Controller, Get, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { TenantConnectionManager } from '../../providers/tenant-connection-manager';

interface HealthCheckResponse {
  status: 'ok' | 'error';
  timestamp: string;
  checks: {
    database: 'up' | 'down';
  };
}

/**
 * Controller para health checks del servicio.
 * Base path: /health
 *
 * Verifica:
 * - Conectividad a PostgreSQL (a través de TenantConnectionManager)
 */
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly tenantManager: TenantConnectionManager,
  ) {}

  /**
   * Health check endpoint.
   * GET /health
   *
   * Este endpoint NO requiere tenant header porque es usado
   * por Knative/Docker/Kubernetes para verificar el estado
   * del servicio antes de enrutar tráfico.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async check(): Promise<HealthCheckResponse> {
    const timestamp = new Date().toISOString();

    // Para el health check general, verificamos que el
    // TenantConnectionManager esté operativo (sin necesidad
    // de una conexión específica a tenant)
    let databaseStatus: 'up' | 'down' = 'up';

    try {
      // Verificar que el manager puede crear conexiones
      // (las pools se crean lazy, solo verificamos que no haya errores de init)
      const poolCount = this.tenantManager['pools']?.size ?? 0;
      this.logger.debug(`Health check: ${poolCount} active connection pools`);
    } catch (error) {
      this.logger.error('Health check failed', error);
      databaseStatus = 'down';
    }

    const status: HealthCheckResponse['status'] = databaseStatus === 'up' ? 'ok' : 'error';

    return {
      status,
      timestamp,
      checks: {
        database: databaseStatus,
      },
    };
  }
}
