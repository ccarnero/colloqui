// Real `SecretExistenceChecker` backed by the T05 `ISecretsStore` — checks
// whether the resource's k8s Secret exists AND has a key named
// `secretName`, WITHOUT ever reading/returning the value into the planner
// (existence only, per the port's contract).

import type { ISecretsStore } from "../../secrets/domain/secrets-store.interface";
import type { SecretExistenceChecker } from "../domain/secret-existence-checker.interface";

export function createK8sSecretExistenceChecker(
  store: ISecretsStore
): SecretExistenceChecker {
  return {
    async exists(tenantId, kind, owner, secretName) {
      const read = await store.readResourceSecret(tenantId, kind, owner);
      if (!read.ok) {
        return { ok: false, error: read.error.message };
      }
      if (read.value === null) {
        return { ok: true, value: false };
      }
      return { ok: true, value: read.value.has(secretName) };
    },
  };
}
