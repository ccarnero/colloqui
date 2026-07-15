// `ISecretsStore` backed by the real Kubernetes Core API — the ONLY
// adapter that ever reads/writes a per-resource k8s Secret
// (`psec-<kind>-<owner>` in `<tenant>-<env>-ns`, SPEC.md decision 4).
//
// Standard in-cluster serviceaccount pattern, mirroring
// `tenant-service`/`registry-service`'s `K8S_CORE_API` usage
// (`@yoizen/database`'s `KubernetesModule`) — no bespoke client wiring.
//
// Secret VALUES are decoded here and returned to the caller (the broker)
// ONLY — this file itself never logs a decoded value, only names/kinds/
// owners/namespaces (SPEC.md hard rule: values never in logs).

import type * as k8s from "@kubernetes/client-node";
import { PinoLoggerService } from "@yoizen/observability";
import { tenantKubernetesNamespaceName } from "@yoizen/shared";
import type { ResourceKind } from "../../plan/domain/plan.interfaces";
import type {
  ISecretsStore,
  SecretBindingSummary,
  SecretsStoreError,
} from "../domain/secrets-store.interface";
import {
  SECRET_LABEL_KEYS,
  secretResourceLabelSelector,
  secretResourceLabels,
} from "../lib/secret-labels";
import { secretResourceName } from "../lib/secret-resource-name";

const PLATFORM_ENVIRONMENT = process.env.PLATFORM_ENVIRONMENT ?? "dev";

function isK8sNotFound(e: unknown): boolean {
  if (typeof e !== "object" || e === null) {
    return false;
  }
  const withResponse = e as { response?: { statusCode?: number } };
  if (withResponse.response?.statusCode === 404) {
    return true;
  }
  const withCode = e as { code?: number };
  return withCode.code === 404;
}

function k8sErrorMessage(e: unknown): string {
  if (typeof e === "object" && e !== null && "response" in e) {
    const msg = (e as { response?: { body?: { message?: string } } }).response
      ?.body?.message;
    if (typeof msg === "string" && msg.length > 0) {
      return msg;
    }
  }
  return e instanceof Error ? e.message : String(e);
}

function decodeSecretData(
  data: Record<string, string> | undefined
): Map<string, string> {
  const decoded = new Map<string, string>();
  if (!data) {
    return decoded;
  }
  for (const [key, base64Value] of Object.entries(data)) {
    decoded.set(key, Buffer.from(base64Value, "base64").toString("utf8"));
  }
  return decoded;
}

function encodeSecretData(
  entries: Map<string, string>
): Record<string, string> {
  const encoded: Record<string, string> = {};
  for (const [key, value] of entries) {
    encoded[key] = Buffer.from(value, "utf8").toString("base64");
  }
  return encoded;
}

export function createK8sSecretsStore(coreApi: k8s.CoreV1Api): ISecretsStore {
  const logger = new PinoLoggerService("secrets.k8s-store");

  return {
    async write(tenantId, name, value, scope) {
      const namespace = tenantKubernetesNamespaceName(
        tenantId,
        PLATFORM_ENVIRONMENT
      );
      const secretName = secretResourceName(scope.kind, scope.owner);
      logger.log(
        `write: secret name='${name}' resource='${scope.kind}/${scope.owner}' -> k8s Secret '${secretName}' namespace='${namespace}' (value NEVER logged)`
      );

      try {
        let existing: k8s.V1Secret | undefined;
        try {
          const response = await coreApi.readNamespacedSecret({
            name: secretName,
            namespace,
          });
          existing = response;
        } catch (readError) {
          if (!isK8sNotFound(readError)) {
            throw readError;
          }
        }

        const currentData = decodeSecretData(
          existing?.data as Record<string, string> | undefined
        );
        currentData.set(name, value);

        const body: k8s.V1Secret = {
          apiVersion: "v1",
          kind: "Secret",
          type: "Opaque",
          metadata: {
            name: secretName,
            namespace,
            labels: secretResourceLabels(tenantId, scope.kind, scope.owner),
          },
          data: encodeSecretData(currentData),
        };

        if (existing) {
          await coreApi.replaceNamespacedSecret({
            name: secretName,
            namespace,
            body,
          });
          logger.log(
            `write: updated existing k8s Secret '${secretName}' (now ${String(currentData.size)} key(s))`
          );
        } else {
          await coreApi.createNamespacedSecret({ namespace, body });
          logger.log(`write: created k8s Secret '${secretName}'`);
        }
        return { ok: true };
      } catch (cause) {
        const message = `k8s write failed for Secret '${secretName}' namespace='${namespace}': ${k8sErrorMessage(cause)}`;
        logger.error(`write: ${message}`);
        const error: SecretsStoreError = { kind: "downstream_error", message };
        return { ok: false, error };
      }
    },

    async list(tenantId) {
      const namespace = tenantKubernetesNamespaceName(
        tenantId,
        PLATFORM_ENVIRONMENT
      );
      logger.log(
        `list: secrets for tenant='${tenantId}' namespace='${namespace}'`
      );

      try {
        const response = await coreApi.listNamespacedSecret({
          namespace,
          labelSelector: secretResourceLabelSelector(tenantId),
        });
        const bindings: SecretBindingSummary[] = [];
        for (const item of response.items ?? []) {
          const labels = item.metadata?.labels ?? {};
          const kind = labels[SECRET_LABEL_KEYS.kind] as
            | ResourceKind
            | undefined;
          const owner = labels[SECRET_LABEL_KEYS.owner];
          if (!kind || !owner) {
            continue;
          }
          const dataKeys = Object.keys(
            (item.data as Record<string, string> | undefined) ?? {}
          );
          for (const name of dataKeys) {
            bindings.push({ name, scope: { kind, owner } });
          }
        }
        logger.log(`list: found ${String(bindings.length)} secret binding(s)`);
        return { ok: true, value: bindings };
      } catch (cause) {
        const message = `k8s list failed namespace='${namespace}': ${k8sErrorMessage(cause)}`;
        logger.error(`list: ${message}`);
        const error: SecretsStoreError = { kind: "downstream_error", message };
        return { ok: false, error };
      }
    },

    async readResourceSecret(tenantId, kind, owner) {
      const namespace = tenantKubernetesNamespaceName(
        tenantId,
        PLATFORM_ENVIRONMENT
      );
      const secretName = secretResourceName(kind, owner);
      logger.log(
        `readResourceSecret: resource='${kind}/${owner}' -> k8s Secret '${secretName}' namespace='${namespace}' (values NEVER logged)`
      );

      try {
        const response = await coreApi.readNamespacedSecret({
          name: secretName,
          namespace,
        });
        const decoded = decodeSecretData(
          response.data as Record<string, string> | undefined
        );
        return { ok: true, value: decoded };
      } catch (cause) {
        if (isK8sNotFound(cause)) {
          logger.log(
            `readResourceSecret: no Secret '${secretName}' found (resource has no bound secrets yet)`
          );
          return { ok: true, value: null };
        }
        const message = `k8s read failed for Secret '${secretName}' namespace='${namespace}': ${k8sErrorMessage(cause)}`;
        logger.error(`readResourceSecret: ${message}`);
        const error: SecretsStoreError = { kind: "downstream_error", message };
        return { ok: false, error };
      }
    },
  };
}
