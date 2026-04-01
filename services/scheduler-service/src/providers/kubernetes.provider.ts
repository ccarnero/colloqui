import type { DynamicModule } from "@nestjs/common";
import { KubernetesModule as BaseKubernetesModule } from "@yoizen/database";

import { K8S_BATCH_API, K8S_CORE_API } from "./k8s-api.tokens";

export { K8S_CORE_API, K8S_BATCH_API };

export const KubernetesModule: DynamicModule = BaseKubernetesModule.register({
  extraApis: [K8S_BATCH_API],
});
