import { Controller, Get, Inject } from '@nestjs/common';
import type * as k8s from '@kubernetes/client-node';
import type { Sql } from 'postgres';
import { K8S_CORE_API } from '../../providers/kubernetes.provider';
import { POSTGRES_SQL } from '../../providers/postgres.provider';

@Controller()
export class HealthController {
  constructor(
    @Inject(K8S_CORE_API) private readonly k8sApi: k8s.CoreV1Api,
    @Inject(POSTGRES_SQL) private readonly sql: Sql,
  ) {}

  @Get('health')
  async check(): Promise<{
    status: string;
    kubernetes: string;
    postgres: string;
  }> {
    const [k8sOk, pgOk] = await Promise.all([
      this.checkKubernetes(),
      this.checkPostgres(),
    ]);

    return {
      status: k8sOk && pgOk ? 'ok' : 'degraded',
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
