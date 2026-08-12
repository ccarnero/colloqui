// `IPlatformResourceDeleter` for channel-service's channel accounts
// (PENDIENTES/12-undeploy.spec.md T01).
//
// Channels are the ONE kind carrying a marker at all: every account apply
// CREATES is stamped `externalId: "manifest:<CHANNEL RESOURCE name>"`
// (`apply/infrastructure/channels-writer.ts:186`, in the `POST
// /channels/accounts` body). So this deleter does NOT reuse the generic
// name-only lookup — it lists `GET /channels/accounts`, matches BOTH the
// account name AND that marker, and only then deletes by the account's live
// id.
//
// WHAT THE MARKER ACTUALLY PROVES — and what it does NOT (reviewer B,
// 2026-08-12): the writer derives it from `channel.name`, NOT from the
// manifest's `metadata.name`. It is therefore an APPLY-PROVENANCE marker
// ("this account was CREATED by an apply of this channel resource, not
// adopted from a hand-made account"), never a per-manifest ownership proof.
// This deleter matches exactly what the writer stamps —
// `manifest:<resourceName>` — because matching the manifest name instead
// found NOTHING for every manifest whose name differs from its channel's
// (the normal case), silently leaving the account live while the run
// reported success. The manifest name is kept for LOGGING only.
//
// Consequence 1 (deliberate, owned-only deletion): an account that carries
// the manifest's resource NAME but not the marker — e.g. one created
// imperatively and later ADOPTED by an apply `update` verdict, which never
// rewrites `externalId` — is reported `not_found` and left alone. Undeploy
// deletes what apply created, never what it merely adopted.
//
// Consequence 2 (FINDING, not fixed here — changing the stamp is a writer
// round and the apply path is untouchable in this task): two manifests of the
// SAME tenant declaring a channel with the SAME name produce the same marker,
// so undeploying either would delete the shared account. The decision-4
// shared-resource guard does not catch it (that guard keys on `external:
// true` references, and this case is two competing OWNERS). A per-manifest
// stamp (`manifest:<manifest>/<channel>`) would fix it in the writer.
//
// The read never projects (and never logs) anything but `id`, `name` and
// `externalId`; the account payload also carries `accessToken`, which is
// deliberately not read here. Same tracedFetch/TENANT_HEADER style as
// `plan/infrastructure/create-http-list-resource-client.ts`.

import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import { TENANT_HEADER } from "@yoizen/shared";
import type { Result } from "../../../lib/result";
import { err, ok } from "../../../lib/result";
import type { IPlatformResourceDeleter } from "../domain/platform-resource-deleter.interface";
import type { UndeployStepError } from "../domain/undeploy.interfaces";
import { createHttpDeleteById } from "./create-http-resource-deleter";

const DEFAULT_TIMEOUT_MS = 10_000;

interface ChannelAccountListItem {
  readonly id: string;
  readonly name: string;
  readonly externalId?: string;
}

/**
 * The exact marker `channels-writer.ts:186` stamps on every account it
 * creates — derived from the CHANNEL RESOURCE's name, never the manifest's.
 * Keep this function and that line in lockstep.
 */
export function channelApplyProvenanceMarker(resourceName: string): string {
  return `manifest:${resourceName}`;
}

export function createChannelsDeleter(
  baseUrl: string
): IPlatformResourceDeleter {
  const logger = new PinoLoggerService("undeploy.channel-deleter");

  // The DELETE half is identical to every other kind's — reuse it, and
  // replace only the marker-checking lookup.
  const deleteById = createHttpDeleteById({
    resourceKind: "channel",
    baseUrl,
    deletePath: "/channels/accounts",
  });

  return {
    async findOwnedId(
      tenantId,
      resourceName,
      manifestName
    ): Promise<Result<string | null, UndeployStepError>> {
      const url = `${baseUrl}/channels/accounts`;
      const marker = channelApplyProvenanceMarker(resourceName);
      logger.log(
        `findOwnedId: GET ${url} channel='${resourceName}' manifest='${manifestName}' tenant='${tenantId}' (deletion key: name + externalId='${marker}' — apply-provenance, see header)`
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
        logger.warn(`findOwnedId: ${message}`);
        return err({
          kind: "lookup_failed",
          resourceKind: "channel",
          resourceName,
          message,
        });
      }

      if (!response.ok) {
        const message = `HTTP ${String(response.status)} from ${url}`;
        logger.warn(`findOwnedId: ${message}`);
        return err({
          kind: "lookup_failed",
          resourceKind: "channel",
          resourceName,
          message,
        });
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch (cause) {
        const message = `invalid JSON from ${url}: ${cause instanceof Error ? cause.message : String(cause)}`;
        logger.warn(`findOwnedId: ${message}`);
        return err({
          kind: "lookup_failed",
          resourceKind: "channel",
          resourceName,
          message,
        });
      }

      const accounts = Array.isArray(body)
        ? (body as ChannelAccountListItem[])
        : [];
      const named = accounts.filter((item) => item.name === resourceName);
      const owned = named.find((item) => item.externalId === marker);

      if (!owned) {
        logger.log(
          `findOwnedId: no channel account named '${resourceName}' with externalId='${marker}' (${String(named.length)} same-named account(s) live, none apply-created — adopted or hand-made accounts are never deleted)`
        );
        return ok(null);
      }

      logger.log(
        `findOwnedId: channel '${resourceName}' is apply-created (externalId='${marker}', manifest='${manifestName}') -> id='${owned.id}'`
      );
      return ok(owned.id);
    },

    deleteById,
  };
}
