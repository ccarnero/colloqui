import {
  REGISTRY_DOMAIN,
  PLATFORM_NON_CHANNEL_TOKEN,
  REGISTRY_PRODUCER,
} from "./constants";

/**
 * Canonical 8-token subject for platform-level (non-messaging) events
 * emitted by `registry-service` and consumed by other platform services
 * (e.g. `adapter-service` for the internal adapter mirror).
 *
 * Format (DOCS/arquitectura/02 §3):
 *   evt.<tenant>.registry-service.platform.<resource>.system.<kind>.v<version>
 *
 * `resource` fills the "channel" slot (e.g. "service"). The "provider"
 * slot is fixed to {@link PLATFORM_NON_CHANNEL_TOKEN} since the event
 * is not tied to a messaging provider.
 */
export function buildRegistryPlatformSubject(
  tenant: string,
  resource: string,
  kind: string,
  version = "v1",
): string {
  return `evt.${tenant}.${REGISTRY_PRODUCER}.${REGISTRY_DOMAIN}.${resource}.${PLATFORM_NON_CHANNEL_TOKEN}.${kind}.${version}`;
}

/**
 * Wildcard subscription pattern for ALL registry-service platform
 * events of a single resource. Used by consumers that only care about
 * the `service` resource stream.
 */
export function buildRegistryPlatformWildcard(resource: string): string {
  return `evt.*.${REGISTRY_PRODUCER}.${REGISTRY_DOMAIN}.${resource}.${PLATFORM_NON_CHANNEL_TOKEN}.*.v1`;
}

/** Resource and event kind constants for the service lifecycle pipeline. */
export const PLATFORM_RESOURCE_SERVICE = "service" as const;
export const PLATFORM_KIND_SERVICE_UPSERTED = "upserted" as const;
export const PLATFORM_KIND_SERVICE_DELETED = "deleted" as const;

/**
 * Payload of an `io.yoizen.registry.service.upserted.v1` event. Kept
 * narrow: only what {@link adapter-service} needs to materialize the
 * internal adapter mirror.
 */
export interface IServiceConfigUpsertedPayload {
  readonly serviceId: string;
  readonly tenantId: string;
  readonly name: string;
  readonly knativeName: string | null;
  readonly namespace: string | null;
  readonly port: number;
  readonly status: string;
  readonly healthCheckPath?: string;
}

/** Payload of an `io.yoizen.registry.service.deleted.v1` event. */
export interface IServiceConfigDeletedPayload {
  readonly serviceId: string;
  readonly tenantId: string;
  readonly name: string;
}

/** CloudEvents `type` strings for the service lifecycle events. */
export const SERVICE_UPSERTED_EVENT_TYPE =
  "io.yoizen.registry.service.upserted.v1" as const;
export const SERVICE_DELETED_EVENT_TYPE =
  "io.yoizen.registry.service.deleted.v1" as const;

/** CloudEvents `source` for registry-originated events. */
export const REGISTRY_EVENT_SOURCE = "//registry-service/services" as const;
