import { beforeEach, describe, expect, it } from "bun:test";
import { FunctionActionService } from "../../src/modules/job-executor/actions/function-action.service";

describe("FunctionActionService", () => {
  let service: FunctionActionService;

  beforeEach(() => {
    service = new FunctionActionService();
  });

  it("registers the four builtin functions", () => {
    expect(service.getRegisteredFunctions().sort()).toEqual([
      "cleanup_old_conversations",
      "export_data",
      "get_conversation_metrics",
      "notify_backend",
    ]);
  });

  it("executes a builtin and wraps its result", async () => {
    const outcome = await service.execute("notify_backend", {
      message: "hello",
    });
    expect(outcome).toEqual({ result: { sent: true } });
  });

  it("throws on an unknown function name", async () => {
    expect(service.execute("does_not_exist")).rejects.toThrow(
      "Unknown function: 'does_not_exist'"
    );
  });

  // Regression: PENDIENTES/09-hallazgos-group-c.md H2 — the removed
  // "python_code" vestige must fail like any unknown function, never
  // report success without doing anything.
  it("rejects python_code like any unknown function (no silent no-op)", async () => {
    expect(service.execute("python_code")).rejects.toThrow(
      "Unknown function: 'python_code'"
    );
  });
});
