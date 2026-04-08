import "reflect-metadata";
import { describe, it, expect, beforeAll, mock } from "bun:test";
import type { WorkflowDefinition } from "@yoizen/shared";

const executeEndpointCall = mock(() =>
  Promise.resolve({ status: 200, data: { ok: true }, headers: {} }),
);
const executeJsFunction = mock(() => Promise.resolve({ computed: 1 }));
const executeServiceBusCall = mock(() =>
  Promise.resolve({ published: true as const, subject: "events.test" }),
);
const executeServiceCall = mock(() =>
  Promise.resolve({ status: 200, data: { result: "svc" }, headers: {} }),
);
const syncExecutionStatus = mock(() => Promise.resolve());

let runWorkflow: (
  workflow: WorkflowDefinition,
  executionId?: string,
) => Promise<import("@yoizen/shared").WorkflowExecutionContext>;

beforeAll(async () => {
  mock.module("@temporalio/workflow", () => ({
    proxyActivities: () => ({
      executeEndpointCall,
      executeJsFunction,
      executeServiceBusCall,
      executeServiceCall,
      syncExecutionStatus,
    }),
  }));
  ({ runWorkflow } = await import("../../src/temporal/workflows"));
});

describe("runWorkflow (temporal/workflows)", () => {
  const base: WorkflowDefinition = {
    name: "wf",
    tenant: "tenant-1",
    application: "orders",
    request: { orderId: "o1" },
    actions: [],
  };

  it("runs jsFunction actions and stores results", async () => {
    executeJsFunction.mockClear();
    const ctx = await runWorkflow({
      ...base,
      actions: [
        { activity: "jsFunction", name: "step1", args: { code: "return 1" } },
      ],
    });
    expect(executeJsFunction).toHaveBeenCalled();
    expect(ctx.results.step1).toEqual({ computed: 1 });
  });

  it("runs endpointCall via http activities", async () => {
    executeEndpointCall.mockClear();
    await runWorkflow({
      ...base,
      actions: [
        {
          activity: "endpointCall",
          name: "api",
          args: {
            method: "GET",
            url: "https://example.test",
          },
        },
      ],
    });
    expect(executeEndpointCall).toHaveBeenCalled();
  });

  it("runs serviceBusCall actions", async () => {
    executeServiceBusCall.mockClear();
    await runWorkflow({
      ...base,
      actions: [
        {
          activity: "serviceBusCall",
          name: "pub",
          args: { subject: "events.order" },
        },
      ],
    });
    expect(executeServiceBusCall).toHaveBeenCalled();
  });

  it("merges parallel branch results into shared context", async () => {
    executeJsFunction.mockImplementation(() => Promise.resolve({ v: 1 }));
    const ctx = await runWorkflow({
      ...base,
      actions: [
        {
          activity: "branch",
          name: "split",
          pathA: [
            {
              activity: "jsFunction",
              name: "branchA",
              args: { code: "return 'a'" },
            },
          ],
          pathB: [
            {
              activity: "jsFunction",
              name: "branchB",
              args: { code: "return 'b'" },
            },
          ],
        },
      ],
    });
    expect(ctx.results.branchA).toBeDefined();
    expect(ctx.results.branchB).toBeDefined();
  });

  it("runs serviceCall via http activities", async () => {
    executeServiceCall.mockClear();
    const ctx = await runWorkflow({
      ...base,
      actions: [
        {
          activity: "serviceCall",
          name: "svc",
          args: {
            serviceId: "my-service-id",
            method: "POST",
            path: "/api/process",
          },
        },
      ],
    });
    expect(executeServiceCall).toHaveBeenCalled();
    expect(ctx.results.svc).toEqual({
      status: 200,
      data: { result: "svc" },
      headers: {},
    });
  });

  it("propagates activity errors", async () => {
    executeJsFunction.mockImplementationOnce(() =>
      Promise.reject(new Error("activity failed")),
    );
    await expect(
      runWorkflow({
        ...base,
        actions: [
          { activity: "jsFunction", name: "bad", args: { code: "throw" } },
        ],
      }),
    ).rejects.toThrow("activity failed");
  });

  it("calls syncExecutionStatus with COMPLETED on success", async () => {
    syncExecutionStatus.mockClear();
    await runWorkflow(
      {
        ...base,
        actions: [
          {
            activity: "jsFunction",
            name: "step",
            args: { code: "return 1" },
          },
        ],
      },
      "exec-123",
    );
    expect(syncExecutionStatus).toHaveBeenCalledWith("exec-123", "COMPLETED");
  });

  it("calls syncExecutionStatus with FAILED on error", async () => {
    syncExecutionStatus.mockClear();
    executeJsFunction.mockImplementationOnce(() =>
      Promise.reject(new Error("boom")),
    );
    await expect(
      runWorkflow(
        {
          ...base,
          actions: [
            {
              activity: "jsFunction",
              name: "bad",
              args: { code: "throw" },
            },
          ],
        },
        "exec-456",
      ),
    ).rejects.toThrow("boom");
    expect(syncExecutionStatus).toHaveBeenCalledWith("exec-456", "FAILED");
  });

  it("skips sync when executionId is not provided", async () => {
    syncExecutionStatus.mockClear();
    await runWorkflow({
      ...base,
      actions: [],
    });
    expect(syncExecutionStatus).not.toHaveBeenCalled();
  });
});
