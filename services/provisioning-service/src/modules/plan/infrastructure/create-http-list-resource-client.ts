// Generic factory for an `IPlatformResourceClient` backed by an internal
// service's `GET <listPath>` (list) endpoint. Follows the same pattern as
// `connector-runtime`'s downstream calls (`tracedFetch` + `TENANT_HEADER`
// forwarding, see `services/connector-runtime/src/activities/service-call.activity.ts`):
// tenant isolation on every call, never throws — network/HTTP failures
// resolve to a typed `DownstreamError`.
//
// READ-ONLY by construction: this factory only ever issues `GET` requests.
// `findByName` lists then filters client-side by name because not every
// internal API supports server-side name filtering yet (only
// connector-admin's `/connectors?name=` does).

import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import { TENANT_HEADER } from "@yoizen/shared";
import type { ResourceKind } from "../domain/plan.interfaces";
import type {
  IPlatformResourceClient,
  LivePlatformResource,
} from "../domain/platform-resource-client.interface";

const DEFAULT_TIMEOUT_MS = 10_000;

export interface HttpListResourceClientOptions<TItem> {
  readonly resourceKind: ResourceKind;
  readonly baseUrl: string;
  readonly listPath: string;
  readonly getName: (item: TItem) => string;
  readonly getExternalId: (item: TItem) => string;
  /**
   * `declaredResource` (T04, manual-loops/provisioning-manifest-gaps-2.md
   * gap 4) is the manifest's OWN desired resource for this kind, when the
   * caller has it — `build-manifest-plan.ts`'s `findByName` call site always
   * passes it (mirrors `serviceComparable`'s T05 precedent). Every existing
   * `getFields` ignores the second argument; `agentComparable.fromLive` (T04)
   * is the first consumer, deciding which OPTIONAL comparable fields to
   * project the same way `serviceComparable` does for scaling fields.
   */
  readonly getFields: (
    item: TItem,
    declaredResource?: unknown
  ) => Record<string, unknown>;
  /** Some list endpoints wrap the array in an envelope, e.g. `{ agents, total }`. */
  readonly unwrapList?: (body: unknown) => TItem[];
}

export function createHttpListResourceClient<TItem>(
  options: HttpListResourceClientOptions<TItem>
): IPlatformResourceClient {
  const logger = new PinoLoggerService(`plan.${options.resourceKind}-client`);

  return {
    async findByName(tenantId, name, declaredResource) {
      const url = `${options.baseUrl}${options.listPath}`;
      logger.log(
        `findByName: GET ${url} kind='${options.resourceKind}' name='${name}' tenant='${tenantId}'`
      );

      let response: Response;
      try {
        response = await tracedFetch(url, {
          method: "GET",
          headers: { [TENANT_HEADER]: tenantId },
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });
      } catch (cause) {
        const message = `network failure calling ${url}: ${cause instanceof Error ? cause.message : String(cause)}`;
        logger.warn(`findByName: ${message}`);
        return {
          ok: false,
          error: {
            kind: "downstream_error",
            resourceKind: options.resourceKind,
            resourceName: name,
            message,
          },
        };
      }

      if (!response.ok) {
        const message = `HTTP ${String(response.status)} from ${url}`;
        logger.warn(`findByName: ${message}`);
        return {
          ok: false,
          error: {
            kind: "downstream_error",
            resourceKind: options.resourceKind,
            resourceName: name,
            message,
          },
        };
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch (cause) {
        const message = `invalid JSON from ${url}: ${cause instanceof Error ? cause.message : String(cause)}`;
        logger.warn(`findByName: ${message}`);
        return {
          ok: false,
          error: {
            kind: "downstream_error",
            resourceKind: options.resourceKind,
            resourceName: name,
            message,
          },
        };
      }

      const items = options.unwrapList
        ? options.unwrapList(body)
        : (body as TItem[]);
      const match = items.find((item) => options.getName(item) === name);

      if (!match) {
        logger.log(
          `findByName: no live ${options.resourceKind} named '${name}' for tenant='${tenantId}'`
        );
        return { ok: true, value: null };
      }

      const value: LivePlatformResource = {
        externalId: options.getExternalId(match),
        fields: options.getFields(match, declaredResource),
      };
      logger.log(
        `findByName: matched ${options.resourceKind} '${name}' -> externalId='${value.externalId}'`
      );
      return { ok: true, value };
    },
  };
}
