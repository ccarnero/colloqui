import {
  KubernetesModule as BaseKubernetesModule,
  K8S_APPS_API,
  K8S_CUSTOM_OBJECTS_API,
} from "@yoizen/database";

export {
  K8S_CORE_API,
  K8S_APPS_API,
  K8S_CUSTOM_OBJECTS_API,
} from "@yoizen/database";

export const KubernetesModule = BaseKubernetesModule.register({
  extraApis: [K8S_APPS_API, K8S_CUSTOM_OBJECTS_API],
});
