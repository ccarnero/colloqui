import { Injectable } from "@nestjs/common";
import { TENANT_HEADER } from "@yoizen/shared";
import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import { workflowServiceConfig } from "../../config";

interface ICachedSlug {
  readonly slug: string;
  readonly expiresAt: number;
}

interface IRegistryServiceResponse {
  readonly id?: unknown;
  readonly name?: unknown;
}

/**
 * Resolves `registered_services.id` (UUID) → `registered_services.name`
 * (slug, e.g. `"echo-service"`) by calling `registry-service`'s
 * `GET /services/:id` endpoint and caching the result in process.
 *
 * Why this exists: the adapter mirror in `adapter-service` (the table
 * `http_adapters`, `context='internal'`) is keyed by `name` (slug),
 * not by UUID. `workflow-http-worker` activities receive the UUID from
 * the workflow definition, so the mirror lookup permanently misses
 * (negative cache TTL = 10s in `AdapterClient`) and falls back to the
 * registry path on every activity. Pre-resolving the slug at workflow
 * start time lets the activity hit the mirror cache directly, removes
 * one HTTP hop from the hot path, and decouples the workflow run from
 * the cold-start of `adapter-service-api`.
 *
 * Cache strategy:
 *  - In-process `Map<key, { slug, expiresAt }>`. Slugs effectively
 *    never change (renaming a registered service is rare and would
 *    invalidate workflow definitions anyway), so a long TTL (1h
 *    default, env-tunable) is safe.
 *  - Single-flight: parallel callers requesting the same key share
 *    one in-flight promise via `Map<key, Promise<string>>`. Prevents
 *    a thundering herd against `registry-service` when a stress test
 *    starts and 200/s of new workflow runs all miss the cold cache.
 *  - Negative cache: a registry 404 (service was deleted) is cached
 *    with a much shorter TTL (60s) so deletions propagate quickly
 *    while still avoiding repeated lookups during a stress run.
 *  - O(1) get/set on `Map`, O(1) deduplication on inflight lookup.
 *
 * Failure modes: any non-2xx or fetch error returns `undefined`
 * (no slug). `WorkflowsService` then leaves the action's `serviceSlug`
 * empty and the activity falls back to the legacy registry path —
 * same behaviour as before this fix existed.
 */
@Injectable()
export class RegisteredServicesResolver {
  private readonly logger = new PinoLoggerService(
    RegisteredServicesResolver.name,
  );
  private readonly cache = new Map<string, ICachedSlug>();
  private readonly inflight = new Map<string, Promise<string | undefined>>();
  private readonly registryUrl = workflowServiceConfig.registryServiceUrl;
  private readonly timeoutMs = workflowServiceConfig.registryLookupTimeoutMs;
  private readonly hitTtlMs = workflowServiceConfig.serviceSlugCacheTtlMs;
  /** Negative cache TTL (deletion propagates faster than rename). */
  private readonly missTtlMs = 60_000;

  /**
   * Resolves the slug for a `(tenantId, serviceId)` pair, returning
   * `undefined` on lookup failure so the caller can keep going.
   *
   * @param tenantId - Tenant scope used for the `x-yoizen-tenant` header.
   * @param serviceId - The UUID stored in the workflow definition.
   * @returns The slug (`registered_services.name`) or `undefined` when
   *          the registry lookup fails / the service does not exist.
   */
  async resolveSlug(
    tenantId: string,
    serviceId: string,
  ): Promise<string | undefined> {
    const key = `${tenantId}:${serviceId}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.slug || undefined;
    }

    const inflight = this.inflight.get(key);
    if (inflight) return inflight;

    const promise = this.fetchAndCache(tenantId, serviceId, key);
    this.inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(key);
    }
  }

  /**
   * Bulk-resolves a set of `serviceId`s for a tenant in parallel.
   * Used by `WorkflowsService.executeWorkflow` to pre-populate slugs
   * for every `serviceCall` action before starting the Temporal run.
   *
   * @param tenantId - Tenant scope (one resolver call per pair).
   * @param serviceIds - Unique UUIDs to resolve. Iterated once.
   * @returns A `Map<serviceId, slug>` containing only successful
   *          resolutions; missing entries fall through to the
   *          legacy registry path inside the activity.
   */
  async resolveSlugs(
    tenantId: string,
    serviceIds: Iterable<string>,
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const ids = Array.from(serviceIds);
    if (ids.length === 0) return out;

    const results = await Promise.all(
      ids.map((id) => this.resolveSlug(tenantId, id)),
    );
    for (let i = 0, len = ids.length; i < len; i++) {
      const slug = results[i];
      const id = ids[i]!;
      if (slug) {
        out.set(id, slug);
      }
    }
    return out;
  }

  /**
   * Test/operational hook: drop every cached entry. Production code
   * should never need to call this — slugs are stable.
   */
  clearCache(): void {
    this.cache.clear();
  }

  private async fetchAndCache(
    tenantId: string,
    serviceId: string,
    key: string,
  ): Promise<string | undefined> {
    const slug = await this.fetchSlug(tenantId, serviceId);
    const expiresAt =
      Date.now() + (slug ? this.hitTtlMs : this.missTtlMs);
    this.cache.set(key, { slug: slug ?? "", expiresAt });
    return slug;
  }

  private async fetchSlug(
    tenantId: string,
    serviceId: string,
  ): Promise<string | undefined> {
    const url = `${this.registryUrl}/services/${encodeURIComponent(serviceId)}`;
    try {
      const res = await tracedFetch(url, {
        method: "GET",
        headers: {
          [TENANT_HEADER]: tenantId,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (res.status === 404) {
        this.logger.warn(
          `Service '${serviceId}' not found in registry (tenant=${tenantId})`,
        );
        return undefined;
      }
      if (!res.ok) {
        this.logger.warn(
          `Registry lookup failed for '${serviceId}': HTTP ${res.status}`,
        );
        return undefined;
      }

      const body = (await res.json()) as IRegistryServiceResponse;
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) {
        this.logger.warn(
          `Registry returned empty name for '${serviceId}' (tenant=${tenantId})`,
        );
        return undefined;
      }
      return name;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Registry lookup error for '${serviceId}' (tenant=${tenantId}): ${msg}`,
      );
      return undefined;
    }
  }
}
