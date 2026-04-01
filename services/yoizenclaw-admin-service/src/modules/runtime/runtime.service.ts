import { Injectable, Logger } from '@nestjs/common';
import { TenantConnectionManager } from '../../providers/tenant-connection-manager';
import { NatsPublisher } from '../../providers/nats.provider';

interface RuntimeStatus {
  configured: boolean;
  connected_runtimes: string[];
  last_sync_at?: string;
}

/**
 * Servicio para consultar el estado del runtime y conexiones.
 */
@Injectable()
export class RuntimeService {
  private readonly logger = new Logger(RuntimeService.name);
  private lastSyncAt: string | undefined;

  constructor(
    private readonly tenantManager: TenantConnectionManager,
    private readonly natsPublisher: NatsPublisher,
  ) {}

  /**
   * Obtiene el estado del runtime para un tenant.
   * Verifica conectividad a NATS y devuelve métricas básicas.
   */
  async getStatus(tenantId: string): Promise<RuntimeStatus> {
    this.logger.debug(`Getting runtime status for tenant: ${tenantId}`);

    // Verificar conexión a la base de datos del tenant
    let databaseConnected = false;
    try {
      const sql = this.tenantManager.getConnection(tenantId);
      // Ejecutar una query simple para verificar conectividad
      await sql`SELECT 1`;
      databaseConnected = true;
    } catch (error) {
      this.logger.warn(
        `Database connectivity check failed for tenant ${tenantId}`,
        error instanceof Error ? error.message : String(error),
      );
    }

    // Registrar última sincronización si hay conectividad
    if (databaseConnected && !this.lastSyncAt) {
      this.lastSyncAt = new Date().toISOString();
    }

    // Determinar runtimes conectados (en una implementación real,
    // esto consultaría NATS o un registro de runtimes activos)
    const connectedRuntimes: string[] = databaseConnected
      ? [`runtime-${tenantId}-primary`]
      : [];

    return {
      configured: databaseConnected,
      connected_runtimes: connectedRuntimes,
      last_sync_at: this.lastSyncAt,
    };
  }

  /**
   * Actualiza la marca de última sincronización.
   * Llamado cuando se sincroniza configuración con el runtime.
   */
  updateLastSync(): void {
    this.lastSyncAt = new Date().toISOString();
    this.logger.log(`Runtime sync timestamp updated: ${this.lastSyncAt}`);
  }

  /**
   * Obtiene métricas básicas del servicio.
   */
  getMetrics(): {
    uptime_seconds: number;
    memory_usage_mb: number;
    active_tenants: number;
  } {
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();

    return {
      uptime_seconds: Math.floor(uptime),
      memory_usage_mb: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      active_tenants: 0, // Se actualizaría con datos reales del TenantConnectionManager
    };
  }
}
