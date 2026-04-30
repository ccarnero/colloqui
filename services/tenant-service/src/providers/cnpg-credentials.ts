import type * as k8s from "@kubernetes/client-node";

/** Decodes a single key from a Secret's `data` map (base64). */
export function decodeKubernetesSecretData(
  secret: k8s.V1Secret | undefined | null,
  key: string,
): string | undefined {
  const raw = secret?.data?.[key];
  if (!raw) return undefined;
  return Buffer.from(raw, "base64").toString("utf8");
}

/**
 * Object-parameter `CoreV1Api.readNamespacedSecret` resolves to `V1Secret` directly.
 * Older / HTTP-info shapes may wrap it as `{ body }`.
 */
export function unwrapNamespacedSecretRead(
  res: unknown,
): k8s.V1Secret | undefined {
  if (!res || typeof res !== "object") return undefined;
  if ("body" in res) {
    const body = (res as { body?: unknown }).body;
    if (
      body &&
      typeof body === "object" &&
      (body as k8s.V1Secret).kind === "Secret"
    ) {
      return body as k8s.V1Secret;
    }
  }
  if ((res as k8s.V1Secret).kind === "Secret") {
    return res as k8s.V1Secret;
  }
  return undefined;
}

/** Password segment from postgres:// or postgresql:// URI (CNPG stores `uri` in app secrets). */
export function passwordFromPostgresUri(uri: string): string | undefined {
  try {
    const u = new URL(uri);
    if (!u.password) return undefined;
    return decodeURIComponent(u.password);
  } catch {
    return undefined;
  }
}

/**
 * CloudNativePG `-app` secrets normally include `password`; some versions only expose `uri`.
 */
export function extractCnpgApplicationPassword(
  secret: k8s.V1Secret | undefined | null,
): string | undefined {
  const direct = decodeKubernetesSecretData(secret, "password");
  if (direct) return direct;
  const uri = decodeKubernetesSecretData(secret, "uri");
  if (uri) return passwordFromPostgresUri(uri);
  const fqdnUri = decodeKubernetesSecretData(secret, "fqdn-uri");
  if (fqdnUri) return passwordFromPostgresUri(fqdnUri);
  return undefined;
}
