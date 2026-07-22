import type { IWorkflowDefinitionDto } from "./services/workflow-api.service";
import {
  deriveWorkflowStatusLabel,
  mapWorkflowStatusToHealth,
} from "./workflow-status.helpers";

function buildWorkflow(
  overrides: Partial<IWorkflowDefinitionDto> = {}
): IWorkflowDefinitionDto {
  return {
    id: "wf1",
    name: "Workflow",
    application: "app1",
    tenantId: "t1",
    actions: [],
    trigger: { type: "message_received" },
    status: "enabled",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("deriveWorkflowStatusLabel", () => {
  it("returns 'disabled' when status is 'disabled', regardless of trigger", () => {
    const wf = buildWorkflow({ status: "disabled" });
    expect(deriveWorkflowStatusLabel(wf)).toBe("disabled");
  });

  it("returns 'active' when enabled and a trigger is present", () => {
    const wf = buildWorkflow({
      status: "enabled",
      trigger: { type: "message_received" },
    });
    expect(deriveWorkflowStatusLabel(wf)).toBe("active");
  });

  it("returns 'draft' when enabled and no trigger is present", () => {
    const wf = buildWorkflow({ status: "enabled", trigger: null });
    expect(deriveWorkflowStatusLabel(wf)).toBe("draft");
  });

  it("treats a missing status as enabled (legacy rows)", () => {
    const wf = buildWorkflow({
      status: undefined,
      trigger: { type: "message_received" },
    });
    expect(deriveWorkflowStatusLabel(wf)).toBe("active");
  });
});

describe("mapWorkflowStatusToHealth", () => {
  it("maps 'active' to 'ok'", () => {
    expect(mapWorkflowStatusToHealth("active")).toBe("ok");
  });

  it("maps 'draft' to 'idle'", () => {
    expect(mapWorkflowStatusToHealth("draft")).toBe("idle");
  });

  it("maps 'disabled' to 'warn'", () => {
    expect(mapWorkflowStatusToHealth("disabled")).toBe("warn");
  });
});
