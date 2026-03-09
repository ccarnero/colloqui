import { Controller, Get, Inject } from '@nestjs/common';
import type * as k8s from '@kubernetes/client-node';
import { K8S_CORE_API } from '../../providers/kubernetes.provider';

@Controller()
export class HealthController {
  constructor(
    @Inject(K8S_CORE_API) private readonly k8sApi: k8s.CoreV1Api,
  ) {}

  @Get('health')
  async check(): Promise<{ status: string; kubernetes: string }> {
    let k8sOk = false;
    try {
      await this.k8sApi.listNamespace({ limit: 1 });
      k8sOk = true;
    } catch {
      k8sOk = false;
    }
    return {
      status: k8sOk ? 'ok' : 'degraded',
      kubernetes: k8sOk ? 'connected' : 'disconnected',
    };
  }
}
