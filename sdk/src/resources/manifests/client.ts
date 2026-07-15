import type { RetryConfig } from "../../core/retry.js";
import type { Transport } from "../../core/transport.js";
import type {
  ManifestApplyResult,
  ManifestPlan,
  ManifestRevision,
  ManifestValidationResult,
} from "./types.js";

export interface ManifestsClientDeps {
  transport: Transport;
}

export interface ManifestCallOptions {
  /** Per-call retry override; `false` disables retries for this call only. */
  retry?: RetryConfig | false;
}

export interface ManifestApplyOptions extends ManifestCallOptions {
  /**
   * Optional KB content bundle — raw tar bytes, base64-encoded into the
   * request body by this client (see `types.ts`'s `ManifestApplyBundle` doc
   * comment). Omit when the manifest has no `file:` KB sources or they were
   * already applied by a previous call.
   */
  bundle?: Uint8Array;
}

export interface ManifestsClient {
  /**
   * `POST /provisioning/manifests/validate` — schema + structural-rule
   * validation, never mutates anything. `manifest` must already be a parsed
   * object (no YAML string support — see `types.ts` header). Never throws
   * for an invalid manifest: `result.valid === false` with `result.errors`
   * populated is the expected failure path.
   */
  validate(
    manifest: Record<string, unknown>,
    opts?: ManifestCallOptions
  ): Promise<ManifestValidationResult>;
  /**
   * `PUT /provisioning/manifests/:name` — validates then stores a new
   * revision (never overwrites a previous one). Rejects with
   * `ValidationError`-shaped 400 (thrown as a generic `SdkError`, `code:
   * "HTTP"`, see `mapStatusToError`) when the manifest fails validation or
   * `metadata.name` doesn't match `name`.
   */
  put(
    name: string,
    manifest: Record<string, unknown>,
    opts?: ManifestCallOptions
  ): Promise<ManifestRevision>;
  /** `GET /provisioning/manifests/:name`. Rejects with `NotFoundError` (404) when no manifest named `name` exists for this tenant. */
  get(name: string, opts?: ManifestCallOptions): Promise<ManifestRevision>;
  /**
   * `POST /provisioning/manifests/:name/plan` — read-only diff, NEVER
   * mutates anything. Rejects with `NotFoundError` (404, unknown manifest)
   * or `ConflictError` (409, dependency cycle detected — see
   * `error.details.body.error.cycle`).
   */
  plan(name: string, opts?: ManifestCallOptions): Promise<ManifestPlan>;
  /**
   * `POST /provisioning/manifests/:name/apply` — executes the latest stored
   * plan in dependency order (create-or-update only, no deletes — v1 has no
   * prune semantics). Pass `opts.bundle` when the manifest has `file:` KB
   * sources whose content needs to travel with this apply call. Rejects
   * with `NotFoundError` (404, unknown manifest) or `ConflictError` (409,
   * cycle detected OR a partial-failure/precondition apply result —
   * `error.details.body.error` carries the typed payload, including
   * `applied`/`pending` resources so the caller can re-apply to resume).
   */
  apply(
    name: string,
    opts?: ManifestApplyOptions
  ): Promise<ManifestApplyResult>;
}

/**
 * Creates the `manifests` namespace client. Follows the `connectors`
 * reference implementation (SPEC.md T08) — see sdk/README.md
 * "Resource clients".
 */
export function createManifestsClient({
  transport,
}: ManifestsClientDeps): ManifestsClient {
  function encodePath(name: string): string {
    return encodeURIComponent(name);
  }

  async function validate(
    manifest: Record<string, unknown>,
    opts: ManifestCallOptions = {}
  ): Promise<ManifestValidationResult> {
    const { body } = await transport.request<ManifestValidationResult>({
      path: "/provisioning/manifests/validate",
      method: "POST",
      body: manifest,
      retry: opts.retry,
    });
    return body;
  }

  async function put(
    name: string,
    manifest: Record<string, unknown>,
    opts: ManifestCallOptions = {}
  ): Promise<ManifestRevision> {
    const { body } = await transport.request<ManifestRevision>({
      path: `/provisioning/manifests/${encodePath(name)}`,
      method: "PUT",
      body: manifest,
      retry: opts.retry,
    });
    return body;
  }

  async function get(
    name: string,
    opts: ManifestCallOptions = {}
  ): Promise<ManifestRevision> {
    const { body } = await transport.request<ManifestRevision>({
      path: `/provisioning/manifests/${encodePath(name)}`,
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  async function plan(
    name: string,
    opts: ManifestCallOptions = {}
  ): Promise<ManifestPlan> {
    const { body } = await transport.request<ManifestPlan>({
      path: `/provisioning/manifests/${encodePath(name)}/plan`,
      method: "POST",
      retry: opts.retry,
    });
    return body;
  }

  async function apply(
    name: string,
    opts: ManifestApplyOptions = {}
  ): Promise<ManifestApplyResult> {
    const requestBody: { bundle?: { contentBase64: string } } = {};
    if (opts.bundle !== undefined) {
      requestBody.bundle = {
        contentBase64: Buffer.from(opts.bundle).toString("base64"),
      };
    }

    const { body } = await transport.request<ManifestApplyResult>({
      path: `/provisioning/manifests/${encodePath(name)}/apply`,
      method: "POST",
      body: requestBody,
      retry: opts.retry,
    });
    return body;
  }

  return { validate, put, get, plan, apply };
}
