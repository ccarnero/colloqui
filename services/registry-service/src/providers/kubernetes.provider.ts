import { Global, Module } from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';
import type { FactoryProvider } from '@nestjs/common';

export const K8S_CORE_API = 'K8S_CORE_API';
export const K8S_CUSTOM_OBJECTS_API = 'K8S_CUSTOM_OBJECTS_API';

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

const coreApiProvider: FactoryProvider = {
  provide: K8S_CORE_API,
  useFactory: (): k8s.CoreV1Api => kc.makeApiClient(k8s.CoreV1Api),
};

const customObjectsProvider: FactoryProvider = {
  provide: K8S_CUSTOM_OBJECTS_API,
  useFactory: (): k8s.CustomObjectsApi =>
    kc.makeApiClient(k8s.CustomObjectsApi),
};

@Global()
@Module({
  providers: [coreApiProvider, customObjectsProvider],
  exports: [coreApiProvider, customObjectsProvider],
})
export class KubernetesModule {}
