import { describe, it, expect } from "bun:test";
import type { WorkflowExecutionContext } from "@yoizen/shared";
import { executeJsFunction } from "../../src/temporal/activities/js-function.activity";

function baseContext(
  overrides: Partial<WorkflowExecutionContext> = {},
): WorkflowExecutionContext {
  return {
    workflow: {
      name: "wf",
      tenant: "t1",
      application: "orders",
    },
    request: { orderId: "o1" },
    results: {},
    ...overrides,
  };
}

describe("executeJsFunction", () => {
  it("evaluates sync code and returns the value", async () => {
    const result = await executeJsFunction(
      { code: "(ctx) => ctx.request.orderId" },
      baseContext(),
    );
    expect(result).toBe("o1");
  });

  it("evaluates async code and awaits the result", async () => {
    const result = await executeJsFunction(
      { code: "async (ctx) => ctx.request.orderId + '-ok'" },
      baseContext(),
    );
    expect(result).toBe("o1-ok");
  });

  it("propagates errors thrown by the user function", async () => {
    await expect(
      executeJsFunction(
        { code: "() => { throw new Error('user code'); }" },
        baseContext(),
      ),
    ).rejects.toThrow("user code");
  });
});
