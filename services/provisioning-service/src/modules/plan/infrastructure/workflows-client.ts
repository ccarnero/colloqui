// `IPlatformResourceClient` for workflow-service's `GET /workflows`.
//
// The live projection uses `workflowComparable.fromLive` — the SAME contract
// the manifest desired projection uses. Workflow comparison is existence-only
// today (see `comparable-fields.ts`): workflow-service's actions/trigger/
// variables columns are not faithfully mappable to the manifest's opaque
// `definition`, so no value field is projected.

import type { IPlatformResourceClient } from "../domain/platform-resource-client.interface";
import { type WorkflowDto, workflowComparable } from "../lib/comparable-fields";
import { createHttpListResourceClient } from "./create-http-list-resource-client";

export function createWorkflowsClient(
  baseUrl: string
): IPlatformResourceClient {
  return createHttpListResourceClient<WorkflowDto>({
    resourceKind: "workflow",
    baseUrl,
    listPath: "/workflows",
    getName: (item) => item.name,
    getExternalId: (item) => item.id,
    getFields: (item) => workflowComparable.fromLive(item),
  });
}
