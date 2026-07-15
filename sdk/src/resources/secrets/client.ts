import type { RetryConfig } from "../../core/retry.js";
import type { Transport } from "../../core/transport.js";
import type { SecretBinding, SecretScope, SecretWriteResult } from "./types.js";

export interface SecretsClientDeps {
  transport: Transport;
}

export interface SecretCallOptions {
  /** Per-call retry override; `false` disables retries for this call only. */
  retry?: RetryConfig | false;
}

export interface SecretsClient {
  /**
   * `PUT /provisioning/secrets/:name` — creates/updates ONE k8s Secret
   * scope-bound to `{kind, owner}` (SPEC.md decision 4: one Secret per
   * resource, never a per-tenant bag). Requires the tenant ADMIN scope at
   * the gateway. Write-only: the response echoes `{name, scope}` ONLY —
   * `value` is never returned, never logged by this client, and never part
   * of any thrown error's `details` (the transport's `mapStatusToError`
   * embeds the RESPONSE body in errors, never the request body).
   */
  set(
    name: string,
    value: string,
    scope: SecretScope,
    opts?: SecretCallOptions
  ): Promise<SecretWriteResult>;
  /** `GET /provisioning/secrets` — names + bindings ONLY, never values (write-only guarantee). Tenant-operator level. */
  list(opts?: SecretCallOptions): Promise<SecretBinding[]>;
}

/**
 * Creates the `secrets` namespace client. Follows the `connectors` reference
 * implementation (SPEC.md T08) — see sdk/README.md "Resource clients".
 */
export function createSecretsClient({
  transport,
}: SecretsClientDeps): SecretsClient {
  function encodePath(name: string): string {
    return encodeURIComponent(name);
  }

  async function set(
    name: string,
    value: string,
    scope: SecretScope,
    opts: SecretCallOptions = {}
  ): Promise<SecretWriteResult> {
    // `value` travels in the request body ONLY — never logged, never
    // interpolated into a log line, never echoed back (write-only
    // guarantee, SPEC.md decision 4).
    const { body } = await transport.request<SecretWriteResult>({
      path: `/provisioning/secrets/${encodePath(name)}`,
      method: "PUT",
      body: { value, scope },
      retry: opts.retry,
    });
    return body;
  }

  async function list(opts: SecretCallOptions = {}): Promise<SecretBinding[]> {
    const { body } = await transport.request<{ secrets: SecretBinding[] }>({
      path: "/provisioning/secrets",
      method: "GET",
      retry: opts.retry,
    });
    return body.secrets;
  }

  return { set, list };
}
