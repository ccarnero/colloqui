import "../../setup-env";
import { describe, expect, it } from "bun:test";
import type { Workflow } from "@yoizen/shared";
import {
  type WorkflowDto,
  workflowComparable,
  workflowExistenceOnlyComparable,
} from "../../../src/modules/plan/lib/comparable-fields";

// manual-loops/provisioning-manifest-gaps-5.md — content-aware workflow
// comparator. `workflowComparable` assumes its `Workflow` argument's
// `definition` has ALREADY had every allowlisted symbolic ref substituted
// with its real platform id (`build-manifest-plan.ts`'s job, not this
// contract's) — every fixture below therefore uses an already-substituted
// `definition`, mirroring what the planner hands the contract in practice.

describe("workflowComparable", () => {
  it("converges to noop: manifest (refs substituted) matches live", () => {
    const manifestWorkflow: Workflow = {
      name: "ticket-router",
      definition: {
        application: "support",
        actions: [{ type: "agentCall", agentId: "agent-real-id-1" }],
      },
    };
    const liveWorkflow: WorkflowDto = {
      id: "wf-1",
      name: "ticket-router",
      application: "support",
      actions: [{ type: "agentCall", agentId: "agent-real-id-1" }],
    };

    const desired = workflowComparable.fromManifest(manifestWorkflow);
    const live = workflowComparable.fromLive(liveWorkflow, manifestWorkflow);
    expect(desired).toEqual(live);
    expect(desired).toEqual({
      application: "support",
      actions: [{ type: "agentCall", agentId: "agent-real-id-1" }],
    });
  });

  it("detects a diverging actions array as an honest update signal (order-sensitive)", () => {
    const manifestWorkflow: Workflow = {
      name: "ticket-router",
      definition: {
        application: "support",
        actions: [
          { type: "agentCall", agentId: "agent-real-id-1" },
          { type: "jsFunction", code: "() => 2" },
        ],
      },
    };
    const liveWorkflow: WorkflowDto = {
      id: "wf-1",
      name: "ticket-router",
      application: "support",
      actions: [{ type: "agentCall", agentId: "agent-real-id-1" }],
    };

    const desired = workflowComparable.fromManifest(manifestWorkflow);
    const live = workflowComparable.fromLive(liveWorkflow, manifestWorkflow);
    expect(desired).not.toEqual(live);
  });

  it("actions comparison is array-order-sensitive (execution order matters)", () => {
    const stepA = { type: "jsFunction", code: "() => 1" };
    const stepB = { type: "jsFunction", code: "() => 2" };
    const manifestWorkflow: Workflow = {
      name: "ticket-router",
      definition: { application: "support", actions: [stepA, stepB] },
    };
    const liveWorkflow: WorkflowDto = {
      id: "wf-1",
      name: "ticket-router",
      application: "support",
      actions: [stepB, stepA],
    };

    const desired = workflowComparable.fromManifest(manifestWorkflow);
    const live = workflowComparable.fromLive(liveWorkflow, manifestWorkflow);
    expect(desired).not.toEqual(live);
  });

  it("trigger/variables omit-symmetry: both sides omit the key when the manifest omits it, even if live has a value", () => {
    const manifestWorkflow: Workflow = {
      name: "ticket-router",
      definition: {
        application: "support",
        actions: [{ type: "agentCall", agentId: "agent-real-id-1" }],
      },
    };
    const liveWorkflow: WorkflowDto = {
      id: "wf-1",
      name: "ticket-router",
      application: "support",
      actions: [{ type: "agentCall", agentId: "agent-real-id-1" }],
      trigger: { type: "channelMessage", config: { accountIds: ["acc-1"] } },
      variables: { region: "us" },
    };

    const desired = workflowComparable.fromManifest(manifestWorkflow);
    const live = workflowComparable.fromLive(liveWorkflow, manifestWorkflow);
    expect(Object.keys(desired)).not.toContain("trigger");
    expect(Object.keys(live)).not.toContain("trigger");
    expect(Object.keys(live)).not.toContain("variables");
    expect(desired).toEqual(live);
  });

  it("trigger/variables are compared when the manifest declares them (declared-gate idiom)", () => {
    const manifestWorkflow: Workflow = {
      name: "ticket-router",
      definition: {
        application: "support",
        actions: [{ type: "agentCall", agentId: "agent-real-id-1" }],
        trigger: { type: "channelMessage", config: { accountIds: ["acc-1"] } },
        variables: { region: "us" },
      },
    };
    const liveWorkflowMatching: WorkflowDto = {
      id: "wf-1",
      name: "ticket-router",
      application: "support",
      actions: [{ type: "agentCall", agentId: "agent-real-id-1" }],
      trigger: { type: "channelMessage", config: { accountIds: ["acc-1"] } },
      variables: { region: "us" },
    };

    const desired = workflowComparable.fromManifest(manifestWorkflow);
    const live = workflowComparable.fromLive(
      liveWorkflowMatching,
      manifestWorkflow
    );
    expect(desired).toEqual(live);
    expect(Object.keys(desired)).toContain("trigger");
    expect(Object.keys(desired)).toContain("variables");

    const liveWorkflowDiverging: WorkflowDto = {
      ...liveWorkflowMatching,
      variables: { region: "eu" },
    };
    const liveDiverging = workflowComparable.fromLive(
      liveWorkflowDiverging,
      manifestWorkflow
    );
    expect(desired).not.toEqual(liveDiverging);
  });

  it("excludes server-only fields (id/tenantId/status/createdAt have no manifest counterpart)", () => {
    const manifestWorkflow: Workflow = {
      name: "ticket-router",
      definition: {
        application: "support",
        actions: [{ type: "agentCall", agentId: "agent-real-id-1" }],
      },
    };
    const desired = workflowComparable.fromManifest(manifestWorkflow);
    expect(Object.keys(desired)).not.toContain("id");
    expect(Object.keys(desired)).not.toContain("tenantId");
    expect(Object.keys(desired)).not.toContain("status");
    expect(Object.keys(desired)).not.toContain("createdAt");
  });

  it("`{{...}}` runtime template strings compare byte-identical on both sides (untouched by substitution)", () => {
    const manifestWorkflow: Workflow = {
      name: "ticket-router",
      definition: {
        application: "support",
        actions: [{ type: "jsFunction", code: "() => ({{env.SOME_VALUE}})" }],
      },
    };
    const liveWorkflow: WorkflowDto = {
      id: "wf-1",
      name: "ticket-router",
      application: "support",
      actions: [{ type: "jsFunction", code: "() => ({{env.SOME_VALUE}})" }],
    };

    expect(workflowComparable.fromManifest(manifestWorkflow)).toEqual(
      workflowComparable.fromLive(liveWorkflow, manifestWorkflow)
    );
  });
});

describe("workflowExistenceOnlyComparable (graceful-degradation fallback)", () => {
  it("projects nothing on either side, regardless of definition content", () => {
    const workflow: Workflow = {
      name: "ticket-router",
      definition: {
        application: "support",
        actions: [{ type: "agentCall", agentId: "agent-real-id-1" }],
      },
    };
    const live: WorkflowDto = {
      id: "wf-1",
      name: "ticket-router",
      application: "support",
      actions: [{ type: "agentCall", agentId: "agent-real-id-2" }],
    };

    expect(workflowExistenceOnlyComparable.fromManifest(workflow)).toEqual({});
    expect(workflowExistenceOnlyComparable.fromLive(live)).toEqual({});
  });
});
