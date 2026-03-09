import { Global, Module } from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';
import type { FactoryProvider } from '@nestjs/common';

export const K8S_CORE_API = 'K8S_CORE_API';
export const K8S_BATCH_API = 'K8S_BATCH_API';

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

const coreApiProvider: FactoryProvider = {
  provide: K8S_CORE_API,
  useFactory: (): k8s.CoreV1Api => kc.makeApiClient(k8s.CoreV1Api),
};

const batchApiProvider: FactoryProvider = {
  provide: K8S_BATCH_API,
  useFactory: (): k8s.BatchV1Api => kc.makeApiClient(k8s.BatchV1Api),
};

@Global()
@Module({
  providers: [coreApiProvider, batchApiProvider],
  exports: [coreApiProvider, batchApiProvider],
})
export class KubernetesModule {}
