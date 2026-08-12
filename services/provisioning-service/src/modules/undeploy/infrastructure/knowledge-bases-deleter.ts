// `IPlatformResourceDeleter` for agent-admin-service's knowledge bases
// (PENDIENTES/12-undeploy.spec.md T01).
//
// A knowledge base has NO ownership marker — agent-admin's KB record carries
// nothing tying it to a manifest — so its deletion key is the manifest's
// resource NAME, resolved through the EXISTING `IAgentAdminKbClient
// .findKbByName` (the very lookup `reconcile-knowledge-base.ts` uses to
// decide create-or-reuse at apply time). No parallel list/find logic.
//
// The DELETE half is the shared `createHttpDeleteById`, which already handles
// this route's live-verified `200 false` "no such id" answer (2026-08-12).
//
// Documents are NOT deleted one by one: `DELETE /admin/knowledge-bases/:id`
// removes the KB with its documents, and undeploy separately drops
// provisioning's own `kb_document_checksums` rows for the manifest
// (`undeploy.service.ts`) so a later re-apply re-embeds from scratch.

import { PinoLoggerService } from "@yoizen/observability";
import type { Result } from "../../../lib/result";
import { err, ok } from "../../../lib/result";
import type { IAgentAdminKbClient } from "../../kb/infrastructure/agent-admin-kb-client";
import type { IPlatformResourceDeleter } from "../domain/platform-resource-deleter.interface";
import type { UndeployStepError } from "../domain/undeploy.interfaces";
import { createHttpDeleteById } from "./create-http-resource-deleter";

export function createKnowledgeBasesDeleter(
  baseUrl: string,
  kbClient: IAgentAdminKbClient
): IPlatformResourceDeleter {
  const logger = new PinoLoggerService("undeploy.knowledgeBase-deleter");

  return {
    async findOwnedId(
      tenantId,
      resourceName,
      manifestName
    ): Promise<Result<string | null, UndeployStepError>> {
      logger.log(
        `findOwnedId: kb='${resourceName}' manifest='${manifestName}' tenant='${tenantId}' (deletion key: name)`
      );
      const found = await kbClient.findKbByName(tenantId, resourceName);
      if (!found.ok) {
        logger.warn(
          `findOwnedId: lookup FAILED for kb '${resourceName}': ${found.error}`
        );
        return err({
          kind: "lookup_failed",
          resourceKind: "knowledgeBase",
          resourceName,
          message: found.error,
        });
      }
      if (!found.value) {
        logger.log(
          `findOwnedId: no live knowledge base named '${resourceName}' for tenant='${tenantId}'`
        );
        return ok(null);
      }
      logger.log(
        `findOwnedId: kb '${resourceName}' -> externalId='${found.value.id}'`
      );
      return ok(found.value.id);
    },

    deleteById: createHttpDeleteById({
      resourceKind: "knowledgeBase",
      baseUrl,
      deletePath: "/admin/knowledge-bases",
    }),
  };
}
