// Generic `IPlatformResourceDeleter` over an internal service's
// `DELETE <path>/:id` route (PENDIENTES/12-undeploy.spec.md T01).
//
// This is the CLIENT layer of the undeploy module — the apply-path writers
// gained nothing: they stay create-or-update only ("decision 2, no
// prune/delete anywhere in this loop"). Style copied from
// `plan/infrastructure/create-http-list-resource-client.ts` (tracedFetch +
// TENANT_HEADER on every call, never throws, typed error out).
//
// The find-by-name half is NOT reimplemented here: it delegates to the
// EXISTING read client for that kind (`PlatformResourceClients`), which is
// the very "same find-by-name the writers already use for create-or-update"
// the spec names as the deletion key for kinds with no marker. Channels DO
// carry a marker (apply-provenance, not per-manifest) and therefore get their
// own deleter (`channels-deleter.ts`).
//
// NOT-FOUND SEMANTICS — live-verified against the running dev cluster
// 2026-08-12 by issuing `DELETE <route>/<random-uuid>` at each downstream:
//   - channel-service, connector-admin, agent-admin (agents, mcp-servers),
//     registry-service, workflow-service answer HTTP 404;
//   - agent-admin's skills, system-variables and knowledge-bases answer
//     HTTP 200 with the literal body `false` (their services return a boolean
//     instead of throwing NotFound).
// Both shapes mean "no such id" and both map to `deleted: false` → the engine
// reports `not_found`, never an error. Any OTHER non-2xx is a real
// `downstream_error`.

import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import { TENANT_HEADER } from "@yoizen/shared";
import type { Result } from "../../../lib/result";
import { err, ok } from "../../../lib/result";
import type { IPlatformResourceClient } from "../../plan/domain/platform-resource-client.interface";
import type { IPlatformResourceDeleter } from "../domain/platform-resource-deleter.interface";
import type {
  UndeployResourceKind,
  UndeployStepError,
} from "../domain/undeploy.interfaces";

const DEFAULT_TIMEOUT_MS = 10_000;

export interface HttpDeleteByIdOptions {
  readonly resourceKind: UndeployResourceKind;
  readonly baseUrl: string;
  /** Path of the DELETE route, `:id` excluded — e.g. `/admin/agents`. */
  readonly deletePath: string;
}

export interface HttpResourceDeleterOptions extends HttpDeleteByIdOptions {
  /** The kind's EXISTING read client — reused verbatim for the lookup step. */
  readonly readClient: IPlatformResourceClient;
}

/**
 * The DELETE half on its own, so the two deleters with a bespoke lookup
 * (`channels-deleter.ts`'s apply-provenance marker,
 * `knowledge-bases-deleter.ts`'s KB list) reuse the exact same HTTP/404/
 * `200 false` handling instead of re-deriving it.
 */
export function createHttpDeleteById(
  options: HttpDeleteByIdOptions
): IPlatformResourceDeleter["deleteById"] {
  const logger = new PinoLoggerService(
    `undeploy.${options.resourceKind}-deleter`
  );

  return async function deleteById(
    tenantId,
    externalId,
    resourceName
  ): Promise<Result<{ deleted: boolean }, UndeployStepError>> {
    const url = `${options.baseUrl}${options.deletePath}/${externalId}`;
    logger.log(
      `deleteById: DELETE ${url} kind='${options.resourceKind}' name='${resourceName}' tenant='${tenantId}'`
    );

    let response: Response;
    try {
      response = await tracedFetch(url, {
        method: "DELETE",
        headers: { [TENANT_HEADER]: tenantId },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
    } catch (cause) {
      const message = `network failure calling DELETE ${url}: ${cause instanceof Error ? cause.message : String(cause)}`;
      logger.warn(`deleteById: ${message}`);
      return err({
        kind: "downstream_error",
        resourceKind: options.resourceKind,
        resourceName,
        message,
      });
    }

    if (response.status === 404) {
      logger.log(
        `deleteById: HTTP 404 from ${url} — already gone, reported not_found`
      );
      return ok({ deleted: false });
    }

    if (!response.ok) {
      const message = `HTTP ${String(response.status)} from DELETE ${url}`;
      logger.warn(`deleteById: ${message}`);
      return err({
        kind: "downstream_error",
        resourceKind: options.resourceKind,
        resourceName,
        message,
      });
    }

    // agent-admin's boolean-returning delete routes (skills,
    // system-variables, knowledge-bases): `200 false` means "no such id".
    const body = (await response.text()).trim();
    if (body === "false") {
      logger.log(
        `deleteById: ${url} answered '200 false' (no such id) — reported not_found`
      );
      return ok({ deleted: false });
    }

    logger.log(
      `deleteById: ${options.resourceKind} '${resourceName}' deleted (externalId='${externalId}')`
    );
    return ok({ deleted: true });
  };
}

/**
 * The full deleter for a kind whose deletion key is its NAME: the lookup
 * delegates to that kind's EXISTING read client (`findByName`) — the same
 * one `build-manifest-plan.ts` uses — and the DELETE half is
 * `createHttpDeleteById` above.
 */
export function createHttpResourceDeleter(
  options: HttpResourceDeleterOptions
): IPlatformResourceDeleter {
  const logger = new PinoLoggerService(
    `undeploy.${options.resourceKind}-deleter`
  );

  return {
    async findOwnedId(
      tenantId,
      resourceName,
      manifestName
    ): Promise<Result<string | null, UndeployStepError>> {
      logger.log(
        `findOwnedId: kind='${options.resourceKind}' name='${resourceName}' manifest='${manifestName}' tenant='${tenantId}' (deletion key: name)`
      );
      const found = await options.readClient.findByName(tenantId, resourceName);
      if (!found.ok) {
        logger.warn(
          `findOwnedId: lookup FAILED for ${options.resourceKind} '${resourceName}': ${found.error.message}`
        );
        return err({
          kind: "lookup_failed",
          resourceKind: options.resourceKind,
          resourceName,
          message: found.error.message,
        });
      }
      if (!found.value) {
        logger.log(
          `findOwnedId: no live ${options.resourceKind} named '${resourceName}' for tenant='${tenantId}'`
        );
        return ok(null);
      }
      logger.log(
        `findOwnedId: ${options.resourceKind} '${resourceName}' -> externalId='${found.value.externalId}'`
      );
      return ok(found.value.externalId);
    },

    deleteById: createHttpDeleteById(options),
  };
}
