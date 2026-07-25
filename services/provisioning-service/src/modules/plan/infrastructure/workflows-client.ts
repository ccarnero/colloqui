// `IPlatformResourceClient` for workflow-service's `GET /workflows`.
//
// The live projection uses `workflowComparable.fromLive` — the SAME contract
// the manifest desired projection uses (manual-loops/
// provisioning-manifest-gaps-5.md content-aware workflow comparator). The
// `declaredResource` passed through here is the manifest's RAW (still
// symbolic, not-yet-substituted) `Workflow` resource — that is fine because
// `fromLive`'s `declared` argument is used ONLY to decide whether
// `trigger`/`variables` are gated into the projection (declared-gate idiom,
// keyed off whether the manifest DECLARES those keys at all), never to read
// their substituted VALUES — key presence is unaffected by ref
// substitution. `build-manifest-plan.ts` separately builds the CONTENT-aware
// desired projection from a pre-substituted working copy before diffing
// against these live `fields`.
import type { Workflow } from "@yoizen/shared";
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
    getFields: (item, declared) =>
      workflowComparable.fromLive(item, declared as Workflow | undefined),
  });
}
