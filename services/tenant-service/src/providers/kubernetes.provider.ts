import { Global, Module } from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';
import type { FactoryProvider } from '@nestjs/common';

export const K8S_CORE_API = 'K8S_CORE_API';
export const K8S_APPS_API = 'K8S_APPS_API';

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

const coreApiProvider: FactoryProvider = {
  provide: K8S_CORE_API,
  useFactory: (): k8s.CoreV1Api => kc.makeApiClient(k8s.CoreV1Api),
};

const appsApiProvider: FactoryProvider = {
  provide: K8S_APPS_API,
  useFactory: (): k8s.AppsV1Api => kc.makeApiClient(k8s.AppsV1Api),
};

@Global()
@Module({
  providers: [coreApiProvider, appsApiProvider],
  exports: [coreApiProvider, appsApiProvider],
})
export class KubernetesModule {}
