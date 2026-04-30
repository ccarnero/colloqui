import { Global, Module, type DynamicModule } from "@nestjs/common";
import * as k8s from "@kubernetes/client-node";
import type { FactoryProvider } from "@nestjs/common";

export const K8S_CORE_API = "K8S_CORE_API";
export const K8S_APPS_API = "K8S_APPS_API";
export const K8S_BATCH_API = "K8S_BATCH_API";
export const K8S_CUSTOM_OBJECTS_API = "K8S_CUSTOM_OBJECTS_API";

function makeK8sProvider(
  kc: k8s.KubeConfig,
  token: string,
): FactoryProvider | null {
  switch (token) {
    case K8S_CORE_API:
      return {
        provide: token,
        useFactory: () => kc.makeApiClient(k8s.CoreV1Api),
      };
    case K8S_APPS_API:
      return {
        provide: token,
        useFactory: () => kc.makeApiClient(k8s.AppsV1Api),
      };
    case K8S_BATCH_API:
      return {
        provide: token,
        useFactory: () => kc.makeApiClient(k8s.BatchV1Api),
      };
    case K8S_CUSTOM_OBJECTS_API:
      return {
        provide: token,
        useFactory: () =>
          kc.makeApiClient(k8s.CustomObjectsApi),
      };
    default:
      return null;
  }
}

/**
 * Creates a `@Global()` NestJS module that provides Kubernetes API
 * clients. Always provides `K8S_CORE_API`; additional APIs are
 * registered via `extraApis`.
 *
 * @example
 * ```ts
 * KubernetesModule.register({ extraApis: [K8S_APPS_API] })
 * ```
 */
@Global()
@Module({})
export class KubernetesModule {
  static register(options?: {
    extraApis?: string[];
  }): DynamicModule {
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();

    const providers: FactoryProvider[] = [
      makeK8sProvider(kc, K8S_CORE_API)!,
    ];

    for (const token of options?.extraApis ?? []) {
      if (token === K8S_CORE_API) continue;
      const provider = makeK8sProvider(kc, token);
      if (!provider) {
        throw new Error(`Unknown K8s API token: ${token}`);
      }
      providers.push(provider);
    }

    return {
      module: KubernetesModule,
      global: true,
      providers,
      exports: providers,
    };
  }
}
