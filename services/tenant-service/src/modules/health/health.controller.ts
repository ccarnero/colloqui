import { Controller, Get, Inject } from '@nestjs/common';
import type * as k8s from '@kubernetes/client-node';
import type { Sql } from 'postgres';
import { K8S_CORE_API } from '../../providers/kubernetes.provider';
import { PLATFORM_POSTGRES_SQL } from '../../providers/platform-postgres.provider';

interface HealthStatus {
  status: string;
  kubernetes: string;
  postgres: string;
}

@Controller()
export class HealthController {
  constructor(
    @Inject(K8S_CORE_API) private readonly k8sApi: k8s.CoreV1Api,
    @Inject(PLATFORM_POSTGRES_SQL) private readonly sql: Sql,
  ) {}

  @Get('health')
  async check(): Promise<HealthStatus> {
    const [k8sOk, pgOk] = await Promise.all([
      this.checkKubernetes(),
      this.checkPostgres(),
    ]);

    const allOk = k8sOk && pgOk;
    return {
      status: allOk ? 'ok' : 'degraded',
      kubernetes: k8sOk ? 'connected' : 'disconnected',
      postgres: pgOk ? 'connected' : 'disconnected',
    };
  }

  private async checkKubernetes(): Promise<boolean> {
    try {
      await this.k8sApi.listNamespace({ limit: 1 });
      return true;
    } catch {
      return false;
    }
  }

  private async checkPostgres(): Promise<boolean> {
    try {
      await this.sql`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
