// Pure label-builder for the per-resource k8s Secret (SPEC.md decision 4:
// labels `{tenant, kind, owner}`). Per-resource isolation is
// APPLICATION-layer, not RBAC-layer — k8s RBAC cannot filter by label, so
// these labels exist for discovery (`GET /secrets` lists by tenant label)
// and defense-in-depth cross-checks in the broker, never as the sole
// isolation mechanism.

import type { ResourceKind } from "../../plan/domain/plan.interfaces";

export interface SecretResourceLabels {
  readonly tenant: string;
  readonly kind: ResourceKind;
  readonly owner: string;
}

const LABEL_PREFIX = "provisioning.yoizen.io";

export function secretResourceLabels(
  tenantId: string,
  kind: ResourceKind,
  owner: string
): Record<string, string> {
  return {
    [`${LABEL_PREFIX}/tenant`]: tenantId,
    [`${LABEL_PREFIX}/kind`]: kind,
    [`${LABEL_PREFIX}/owner`]: owner,
  };
}

export function secretResourceLabelSelector(tenantId: string): string {
  return `${LABEL_PREFIX}/tenant=${tenantId}`;
}

export const SECRET_LABEL_KEYS = {
  tenant: `${LABEL_PREFIX}/tenant`,
  kind: `${LABEL_PREFIX}/kind`,
  owner: `${LABEL_PREFIX}/owner`,
} as const;
