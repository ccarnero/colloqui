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
const executeChannelSend = mock(() =>
  Promise.resolve({
    published: true as const,
    subject: "evt.tenant-1.messaging.whatsapp.meta.send.v1",
  }),
);
const executeServiceCall = mock(() =>
  Promise.resolve({ status: 200, data: { result: "svc" }, headers: {} }),
);
const executeAgentCall = mock(() =>
  Promise.resolve({
    status: 200,
    data: { reply: "agent-said" },
    headers: {},
  }),
);
const publishExecutionCompletedEvent = mock(() => Promise.resolve());

let runWorkflow: (
  workflow: WorkflowDefinition,
  executionId?: string,
  systemVariables?: Record<string, unknown>,
) => Promise<import("@yoizen/shared").WorkflowExecutionContext>;

beforeAll(async () => {
  mock.module("@temporalio/workflow", () => ({
    proxyActivities: () => ({
      executeEndpointCall,
      executeJsFunction,
      executeServiceBusCall,
      executeChannelSend,
      executeServiceCall,
      executeAgentCall,
      publishExecutionCompletedEvent,
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

  it("resolves templates in serviceCall path and nested data", async () => {
    executeJsFunction.mockImplementation(() =>
      Promise.resolve({
        status: 200,
        data: { sku: "SKU1" },
        headers: {},
      }),
    );
    executeServiceCall.mockClear();
    await runWorkflow({
      ...base,
      actions: [
        {
          activity: "jsFunction",
          name: "prev",
          args: { code: "return {}" },
        },
        {
          activity: "serviceCall",
          name: "svc",
          args: {
            serviceId: "svc-id",
            method: "POST",
            path: "/items/{{results.prev.data.sku}}/detail",
            data: {
              ref: "{{results.prev.data.sku}}",
            },
          },
        },
      ],
    });
    expect(executeServiceCall).toHaveBeenCalledWith(
      {
        serviceId: "svc-id",
        method: "POST",
        path: "/items/SKU1/detail",
        data: {
          ref: "SKU1",
        },
      },
      "tenant-1",
    );
    executeJsFunction.mockImplementation(() =>
      Promise.resolve({ computed: 1 }),
    );
  });

  it("runs agentCall via http activities", async () => {
    executeAgentCall.mockClear();
    const ctx = await runWorkflow({
      ...base,
      actions: [
        {
          activity: "agentCall",
          name: "yc",
          args: {
            agentId: "550e8400-e29b-41d4-a716-446655440000",
            message: "Hello",
          },
        },
      ],
    });
    expect(executeAgentCall).toHaveBeenCalled();
    expect(ctx.results.yc).toEqual({
      status: 200,
      data: { reply: "agent-said" },
      headers: {},
    });
  });

  it("runs channelSend actions", async () => {
    executeChannelSend.mockClear();
    const ctx = await runWorkflow({
      ...base,
      actions: [
        {
          activity: "channelSend",
          name: "send",
          args: {
            accountId: "acc-1",
            channel: "whatsapp",
            provider: "meta",
            to: "+5491112345678",
            type: "text",
            text: "Hello from workflow",
          },
        },
      ],
    });
    expect(executeChannelSend).toHaveBeenCalled();
    expect(ctx.results.send).toBeDefined();
  });

  it("threads workflow.causal into channelSend activity", async () => {
    executeChannelSend.mockClear();
    await runWorkflow({
      ...base,
      causal: {
        causation_id: "evt-root",
        correlation_id: "conv-1",
        depth: 0,
      },
      actions: [
        {
          activity: "channelSend",
          name: "send",
          args: {
            accountId: "acc-1",
            channel: "telegram",
            provider: "telegram",
            to: "123",
            type: "text",
            text: "hi",
          },
        },
      ],
    });
    const call = executeChannelSend.mock.calls[0];
    /* args, tenantId, causal */
    expect(call).toHaveLength(3);
    expect(call[2]).toEqual({
      causation_id: "evt-root",
      correlation_id: "conv-1",
      depth: 0,
    });
  });

  it("passes undefined causal to channelSend when workflow is a causal root", async () => {
    executeChannelSend.mockClear();
    await runWorkflow({
      ...base,
      actions: [
        {
          activity: "channelSend",
          name: "send",
          args: {
            accountId: "acc-1",
            channel: "telegram",
            provider: "telegram",
            to: "123",
            type: "text",
          },
        },
      ],
    });
    const call = executeChannelSend.mock.calls[0];
    expect(call[2]).toBeUndefined();
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

  it("calls publishExecutionCompletedEvent with COMPLETED on success", async () => {
    publishExecutionCompletedEvent.mockClear();
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
    expect(publishExecutionCompletedEvent).toHaveBeenCalledWith(
      "exec-123",
      "COMPLETED",
      "tenant-1",
      "wf",
    );
  });

  it("calls publishExecutionCompletedEvent with FAILED on error", async () => {
    publishExecutionCompletedEvent.mockClear();
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
    expect(publishExecutionCompletedEvent).toHaveBeenCalledWith(
      "exec-456",
      "FAILED",
      "tenant-1",
      "wf",
    );
  });

  it("skips publish when executionId is not provided", async () => {
    publishExecutionCompletedEvent.mockClear();
    await runWorkflow({
      ...base,
      actions: [],
    });
    expect(publishExecutionCompletedEvent).not.toHaveBeenCalled();
  });

  describe("conditional action", () => {
    it("executes the first matching branch", async () => {
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ status: "aprobado" }),
      );
      const ctx = await runWorkflow({
        ...base,
        actions: [
          {
            activity: "jsFunction",
            name: "check",
            args: { code: "return { status: 'aprobado' }" },
          },
          {
            activity: "conditional",
            name: "route",
            branches: [
              {
                label: "approved",
                condition: {
                  variable: "results.check.status",
                  comparator: "eq",
                  value: "aprobado",
                },
                actions: [
                  {
                    activity: "jsFunction",
                    name: "onApproved",
                    args: { code: "return 'approved-path'" },
                  },
                ],
              },
              {
                label: "rejected",
                condition: {
                  variable: "results.check.status",
                  comparator: "eq",
                  value: "rechazado",
                },
                actions: [
                  {
                    activity: "jsFunction",
                    name: "onRejected",
                    args: { code: "return 'rejected-path'" },
                  },
                ],
              },
            ],
          },
        ],
      });
      expect(ctx.results.onApproved).toBeDefined();
      expect(ctx.results.onRejected).toBeUndefined();
      expect(ctx.results.route).toEqual({ matchedBranch: "approved" });
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ computed: 1 }),
      );
    });

    it("executes the second branch when first does not match", async () => {
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ status: "rechazado" }),
      );
      const ctx = await runWorkflow({
        ...base,
        actions: [
          {
            activity: "jsFunction",
            name: "check",
            args: { code: "return { status: 'rechazado' }" },
          },
          {
            activity: "conditional",
            name: "route",
            branches: [
              {
                label: "approved",
                condition: {
                  variable: "results.check.status",
                  comparator: "eq",
                  value: "aprobado",
                },
                actions: [
                  {
                    activity: "jsFunction",
                    name: "onApproved",
                    args: { code: "return 'approved-path'" },
                  },
                ],
              },
              {
                label: "rejected",
                condition: {
                  variable: "results.check.status",
                  comparator: "eq",
                  value: "rechazado",
                },
                actions: [
                  {
                    activity: "jsFunction",
                    name: "onRejected",
                    args: { code: "return 'rejected-path'" },
                  },
                ],
              },
            ],
          },
        ],
      });
      expect(ctx.results.onApproved).toBeUndefined();
      expect(ctx.results.onRejected).toBeDefined();
      expect(ctx.results.route).toEqual({ matchedBranch: "rejected" });
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ computed: 1 }),
      );
    });

    it("executes default when no branch matches", async () => {
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ status: "pending" }),
      );
      const ctx = await runWorkflow({
        ...base,
        actions: [
          {
            activity: "jsFunction",
            name: "check",
            args: { code: "return { status: 'pending' }" },
          },
          {
            activity: "conditional",
            name: "route",
            branches: [
              {
                label: "approved",
                condition: {
                  variable: "results.check.status",
                  comparator: "eq",
                  value: "aprobado",
                },
                actions: [
                  {
                    activity: "jsFunction",
                    name: "onApproved",
                    args: { code: "return 'ok'" },
                  },
                ],
              },
            ],
            default: [
              {
                activity: "jsFunction",
                name: "onDefault",
                args: { code: "return 'fallback'" },
              },
            ],
          },
        ],
      });
      expect(ctx.results.onApproved).toBeUndefined();
      expect(ctx.results.onDefault).toBeDefined();
      expect(ctx.results.route).toEqual({ matchedBranch: "default" });
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ computed: 1 }),
      );
    });

    it("returns null matchedBranch when no match and no default", async () => {
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ status: "unknown" }),
      );
      const ctx = await runWorkflow({
        ...base,
        actions: [
          {
            activity: "jsFunction",
            name: "check",
            args: { code: "return { status: 'unknown' }" },
          },
          {
            activity: "conditional",
            name: "route",
            branches: [
              {
                label: "approved",
                condition: {
                  variable: "results.check.status",
                  comparator: "eq",
                  value: "aprobado",
                },
                actions: [],
              },
            ],
          },
        ],
      });
      expect(ctx.results.route).toEqual({ matchedBranch: null });
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ computed: 1 }),
      );
    });

    it("resolves templates in condition value", async () => {
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ status: "ok", threshold: "5" }),
      );
      const ctx = await runWorkflow({
        ...base,
        request: { expectedStatus: "ok" },
        actions: [
          {
            activity: "jsFunction",
            name: "check",
            args: { code: "return { status: 'ok', threshold: '5' }" },
          },
          {
            activity: "conditional",
            name: "route",
            branches: [
              {
                label: "match",
                condition: {
                  variable: "results.check.status",
                  comparator: "eq",
                  value: "{{request.expectedStatus}}",
                },
                actions: [
                  {
                    activity: "jsFunction",
                    name: "matched",
                    args: { code: "return 'template-resolved'" },
                  },
                ],
              },
            ],
          },
        ],
      });
      expect(ctx.results.matched).toBeDefined();
      expect(ctx.results.route).toEqual({ matchedBranch: "match" });
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ computed: 1 }),
      );
    });

    it("supports gt comparator for numeric values", async () => {
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ score: 85 }),
      );
      const ctx = await runWorkflow({
        ...base,
        actions: [
          {
            activity: "jsFunction",
            name: "score",
            args: { code: "return { score: 85 }" },
          },
          {
            activity: "conditional",
            name: "route",
            branches: [
              {
                label: "high",
                condition: {
                  variable: "results.score.score",
                  comparator: "gt",
                  value: "80",
                },
                actions: [
                  {
                    activity: "jsFunction",
                    name: "highScore",
                    args: { code: "return 'high'" },
                  },
                ],
              },
            ],
          },
        ],
      });
      expect(ctx.results.highScore).toBeDefined();
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ computed: 1 }),
      );
    });

    it("supports contains comparator", async () => {
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ message: "hello world greeting" }),
      );
      const ctx = await runWorkflow({
        ...base,
        actions: [
          {
            activity: "jsFunction",
            name: "msg",
            args: { code: "return { message: 'hello world greeting' }" },
          },
          {
            activity: "conditional",
            name: "route",
            branches: [
              {
                label: "hasHello",
                condition: {
                  variable: "results.msg.message",
                  comparator: "contains",
                  value: "hello",
                },
                actions: [
                  {
                    activity: "jsFunction",
                    name: "found",
                    args: { code: "return 'found-hello'" },
                  },
                ],
              },
            ],
          },
        ],
      });
      expect(ctx.results.found).toBeDefined();
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ computed: 1 }),
      );
    });

    it("supports exists comparator", async () => {
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ data: { name: "test" } }),
      );
      const ctx = await runWorkflow({
        ...base,
        actions: [
          {
            activity: "jsFunction",
            name: "prev",
            args: { code: "return { data: { name: 'test' } }" },
          },
          {
            activity: "conditional",
            name: "route",
            branches: [
              {
                label: "dataExists",
                condition: {
                  variable: "results.prev.data",
                  comparator: "exists",
                  value: "",
                },
                actions: [
                  {
                    activity: "jsFunction",
                    name: "exists",
                    args: { code: "return 'exists'" },
                  },
                ],
              },
            ],
          },
        ],
      });
      expect(ctx.results.exists).toBeDefined();
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ computed: 1 }),
      );
    });

    it("supports notExists comparator", async () => {
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ data: {} }),
      );
      const ctx = await runWorkflow({
        ...base,
        actions: [
          {
            activity: "jsFunction",
            name: "prev",
            args: { code: "return { data: {} }" },
          },
          {
            activity: "conditional",
            name: "route",
            branches: [
              {
                label: "missing",
                condition: {
                  variable: "results.prev.data.nonexistent",
                  comparator: "notExists",
                  value: "",
                },
                actions: [
                  {
                    activity: "jsFunction",
                    name: "notExists",
                    args: { code: "return 'not-exists'" },
                  },
                ],
              },
            ],
          },
        ],
      });
      expect(ctx.results["notExists"]).toBeDefined();
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ computed: 1 }),
      );
    });

    it("supports neq comparator", async () => {
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ status: "active" }),
      );
      const ctx = await runWorkflow({
        ...base,
        actions: [
          {
            activity: "jsFunction",
            name: "prev",
            args: { code: "return { status: 'active' }" },
          },
          {
            activity: "conditional",
            name: "route",
            branches: [
              {
                label: "notInactive",
                condition: {
                  variable: "results.prev.status",
                  comparator: "neq",
                  value: "inactive",
                },
                actions: [
                  {
                    activity: "jsFunction",
                    name: "different",
                    args: { code: "return 'neq-passed'" },
                  },
                ],
              },
            ],
          },
        ],
      });
      expect(ctx.results.different).toBeDefined();
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ computed: 1 }),
      );
    });

    it("supports gte comparator (greater than or equal)", async () => {
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ score: 80 }),
      );
      const ctx = await runWorkflow({
        ...base,
        actions: [
          {
            activity: "jsFunction",
            name: "score",
            args: { code: "return { score: 80 }" },
          },
          {
            activity: "conditional",
            name: "route",
            branches: [
              {
                label: "pass",
                condition: {
                  variable: "results.score.score",
                  comparator: "gte",
                  value: "80",
                },
                actions: [
                  {
                    activity: "jsFunction",
                    name: "gtePass",
                    args: { code: "return 'gte-passed'" },
                  },
                ],
              },
            ],
          },
        ],
      });
      expect(ctx.results.gtePass).toBeDefined();
      expect(ctx.results.route).toEqual({ matchedBranch: "pass" });
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ computed: 1 }),
      );
    });

    it("supports lte comparator (less than or equal)", async () => {
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ score: 30 }),
      );
      const ctx = await runWorkflow({
        ...base,
        actions: [
          {
            activity: "jsFunction",
            name: "score",
            args: { code: "return { score: 30 }" },
          },
          {
            activity: "conditional",
            name: "route",
            branches: [
              {
                label: "low",
                condition: {
                  variable: "results.score.score",
                  comparator: "lte",
                  value: "30",
                },
                actions: [
                  {
                    activity: "jsFunction",
                    name: "ltePass",
                    args: { code: "return 'lte-passed'" },
                  },
                ],
              },
            ],
          },
        ],
      });
      expect(ctx.results.ltePass).toBeDefined();
      expect(ctx.results.route).toEqual({ matchedBranch: "low" });
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ computed: 1 }),
      );
    });

    it("handles numeric string comparison — '5' vs 5 works via Number coercion", async () => {
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ count: "5" }),
      );
      const ctx = await runWorkflow({
        ...base,
        actions: [
          {
            activity: "jsFunction",
            name: "val",
            args: { code: "return { count: '5' }" },
          },
          {
            activity: "conditional",
            name: "route",
            branches: [
              {
                label: "numericMatch",
                condition: {
                  variable: "results.val.count",
                  comparator: "eq",
                  value: "5",
                },
                actions: [
                  {
                    activity: "jsFunction",
                    name: "numMatch",
                    args: { code: "return 'num-match'" },
                  },
                ],
              },
            ],
          },
        ],
      });
      expect(ctx.results.numMatch).toBeDefined();
      expect(ctx.results.route).toEqual({ matchedBranch: "numericMatch" });
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ computed: 1 }),
      );
    });

    it("empty string does NOT equal zero with eq comparator", async () => {
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ value: "" }),
      );
      const ctx = await runWorkflow({
        ...base,
        actions: [
          {
            activity: "jsFunction",
            name: "val",
            args: { code: "return { value: '' }" },
          },
          {
            activity: "conditional",
            name: "route",
            branches: [
              {
                label: "zeroMatch",
                condition: {
                  variable: "results.val.value",
                  comparator: "eq",
                  value: "0",
                },
                actions: [
                  {
                    activity: "jsFunction",
                    name: "zeroMatched",
                    args: { code: "return 'zero-match'" },
                  },
                ],
              },
            ],
          },
        ],
      });
      expect(ctx.results.zeroMatched).toBeUndefined();
      expect(ctx.results.route).toEqual({ matchedBranch: null });
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ computed: 1 }),
      );
    });

    it("eq comparator is case-sensitive", async () => {
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ status: "Approved" }),
      );
      const ctx = await runWorkflow({
        ...base,
        actions: [
          {
            activity: "jsFunction",
            name: "check",
            args: { code: "return { status: 'Approved' }" },
          },
          {
            activity: "conditional",
            name: "route",
            branches: [
              {
                label: "lowercase",
                condition: {
                  variable: "results.check.status",
                  comparator: "eq",
                  value: "approved",
                },
                actions: [
                  {
                    activity: "jsFunction",
                    name: "lowerMatch",
                    args: { code: "return 'lower'" },
                  },
                ],
              },
            ],
          },
        ],
      });
      expect(ctx.results.lowerMatch).toBeUndefined();
      expect(ctx.results.route).toEqual({ matchedBranch: null });
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ computed: 1 }),
      );
    });

    it("contains with empty substring returns true", async () => {
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ message: "hello" }),
      );
      const ctx = await runWorkflow({
        ...base,
        actions: [
          {
            activity: "jsFunction",
            name: "msg",
            args: { code: "return { message: 'hello' }" },
          },
          {
            activity: "conditional",
            name: "route",
            branches: [
              {
                label: "emptyContains",
                condition: {
                  variable: "results.msg.message",
                  comparator: "contains",
                  value: "",
                },
                actions: [
                  {
                    activity: "jsFunction",
                    name: "found",
                    args: { code: "return 'contains-empty'" },
                  },
                ],
              },
            ],
          },
        ],
      });
      expect(ctx.results.found).toBeDefined();
      expect(ctx.results.route).toEqual({ matchedBranch: "emptyContains" });
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ computed: 1 }),
      );
    });

    it("coerces object left value to [object Object] string for eq", async () => {
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ data: { nested: true } }),
      );
      const ctx = await runWorkflow({
        ...base,
        actions: [
          {
            activity: "jsFunction",
            name: "obj",
            args: { code: "return { data: { nested: true } }" },
          },
          {
            activity: "conditional",
            name: "route",
            branches: [
              {
                label: "objMatch",
                condition: {
                  variable: "results.obj.data",
                  comparator: "eq",
                  value: "[object Object]",
                },
                actions: [
                  {
                    activity: "jsFunction",
                    name: "objMatched",
                    args: { code: "return 'obj-match'" },
                  },
                ],
              },
            ],
          },
        ],
      });
      expect(ctx.results.objMatched).toBeDefined();
      expect(ctx.results.route).toEqual({ matchedBranch: "objMatch" });
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ computed: 1 }),
      );
    });
  });

  describe("variable resolution via {{variables.*}}", () => {
    it("resolves {{variables.workflow.pais}} from workflow definition", async () => {
      executeJsFunction.mockClear();
      await runWorkflow({
        ...base,
        variables: { pais: "Argentina", moneda: "ARS" },
        actions: [
          {
            activity: "jsFunction",
            name: "step",
            args: { code: "return 1" },
          },
        ],
      });
      // The context is passed to jsFunction — verify the variable was resolved
      // by checking the context passed as second arg
      const callArgs = executeJsFunction.mock.calls[0];
      const ctx = callArgs[1] as import("@yoizen/shared").WorkflowExecutionContext;
      expect(ctx.variables.workflow.pais).toBe("Argentina");
      expect(ctx.variables.workflow.moneda).toBe("ARS");
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ computed: 1 }),
      );
    });

    it("resolves {{variables.system.companyName}} from systemVariables passed to runWorkflow", async () => {
      executeJsFunction.mockClear();
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
        undefined,
        { companyName: "Yoizen Corp", region: "LATAM" },
      );
      const callArgs = executeJsFunction.mock.calls[0];
      const ctx = callArgs[1] as import("@yoizen/shared").WorkflowExecutionContext;
      expect(ctx.variables.system.companyName).toBe("Yoizen Corp");
      expect(ctx.variables.system.region).toBe("LATAM");
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ computed: 1 }),
      );
    });

    it("resolves {{variables.previous.reply}} after a previous action", async () => {
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ reply: "first" }),
      );
      executeServiceCall.mockClear();
      await runWorkflow({
        ...base,
        actions: [
          {
            activity: "jsFunction",
            name: "first",
            args: { code: "return { reply: 'first' }" },
          },
          {
            activity: "serviceCall",
            name: "second",
            args: {
              serviceId: "svc-id",
              method: "POST",
              path: "/api?reply={{variables.previous.reply}}",
            },
          },
        ],
      });
      expect(executeServiceCall).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "/api?reply=first",
        }),
        "tenant-1",
        undefined,
      );
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ computed: 1 }),
      );
    });

    it("resolves {{variables.node.stepName.field}} correctly", async () => {
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ sku: "ABC123" }),
      );
      executeServiceCall.mockClear();
      await runWorkflow({
        ...base,
        actions: [
          {
            activity: "jsFunction",
            name: "lookup",
            args: { code: "return { sku: 'ABC123' }" },
          },
          {
            activity: "serviceCall",
            name: "useIt",
            args: {
              serviceId: "svc-id",
              method: "POST",
              path: "/items/{{variables.node.lookup.sku}}",
            },
          },
        ],
      });
      expect(executeServiceCall).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "/items/ABC123",
        }),
        "tenant-1",
        undefined,
      );
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ computed: 1 }),
      );
    });

    it("resolves unknown variable paths to empty string", async () => {
      executeServiceCall.mockClear();
      await runWorkflow({
        ...base,
        actions: [
          {
            activity: "serviceCall",
            name: "svc",
            args: {
              serviceId: "svc-id",
              method: "POST",
              path: "/items/{{variables.nonexistent.foo}}",
            },
          },
        ],
      });
      expect(executeServiceCall).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "/items/",
        }),
        "tenant-1",
        undefined,
      );
    });

    it("mixes {{request.*}} and {{variables.workflow.*}} resolution", async () => {
      executeServiceCall.mockClear();
      await runWorkflow({
        ...base,
        request: { orderId: "o1" },
        variables: { env: "production" },
        actions: [
          {
            activity: "serviceCall",
            name: "svc",
            args: {
              serviceId: "svc-id",
              method: "POST",
              path: "/orders/{{request.orderId}}?env={{variables.workflow.env}}",
            },
          },
        ],
      });
      expect(executeServiceCall).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "/orders/o1?env=production",
        }),
        "tenant-1",
        undefined,
      );
    });
  });

  describe("context variable initialization in runWorkflow", () => {
    it("initializes variables.workflow from WorkflowDefinition.variables", async () => {
      executeJsFunction.mockClear();
      await runWorkflow({
        ...base,
        variables: { foo: "bar", count: 42 },
        actions: [
          {
            activity: "jsFunction",
            name: "step",
            args: { code: "return 1" },
          },
        ],
      });
      const callArgs = executeJsFunction.mock.calls[0];
      const ctx = callArgs[1] as import("@yoizen/shared").WorkflowExecutionContext;
      expect(ctx.variables.workflow).toEqual({ foo: "bar", count: 42 });
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ computed: 1 }),
      );
    });

    it("initializes variables.system from the third argument", async () => {
      executeJsFunction.mockClear();
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
        undefined,
        { apiVersion: "v2", debug: true },
      );
      const callArgs = executeJsFunction.mock.calls[0];
      const ctx = callArgs[1] as import("@yoizen/shared").WorkflowExecutionContext;
      expect(ctx.variables.system).toEqual({ apiVersion: "v2", debug: true });
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ computed: 1 }),
      );
    });

    it("initializes variables.request from WorkflowDefinition.request", async () => {
      executeJsFunction.mockClear();
      await runWorkflow({
        ...base,
        request: { orderId: "o1", userId: "u99" },
        actions: [
          {
            activity: "jsFunction",
            name: "step",
            args: { code: "return 1" },
          },
        ],
      });
      const callArgs = executeJsFunction.mock.calls[0];
      const ctx = callArgs[1] as import("@yoizen/shared").WorkflowExecutionContext;
      expect(ctx.variables.request).toEqual({ orderId: "o1", userId: "u99" });
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ computed: 1 }),
      );
    });

    it("starts with empty variables.previous and populates after first action", async () => {
      const previousSnapshots: Record<string, unknown>[] = [];
      executeJsFunction.mockImplementation((_args: unknown, ctx: import("@yoizen/shared").WorkflowExecutionContext) => {
        previousSnapshots.push({ ...ctx.variables.previous });
        return Promise.resolve({ status: "ok" });
      });
      await runWorkflow({
        ...base,
        actions: [
          {
            activity: "jsFunction",
            name: "first",
            args: { code: "return { status: 'ok' }" },
          },
          {
            activity: "jsFunction",
            name: "second",
            args: { code: "return 1" },
          },
        ],
      });
      // First call: previous should be empty
      expect(previousSnapshots[0]).toEqual({});
      // Second call: previous should be the first action's result
      expect(previousSnapshots[1]).toEqual({ status: "ok" });
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ computed: 1 }),
      );
    });

    it("variables.node accumulates ALL action results keyed by action name", async () => {
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ accumulated: true }),
      );
      executeJsFunction.mockClear();
      await runWorkflow({
        ...base,
        actions: [
          { activity: "jsFunction", name: "s1", args: { code: "return { a: 1 }" } },
          { activity: "jsFunction", name: "s2", args: { code: "return { b: 2 }" } },
          { activity: "jsFunction", name: "s3", args: { code: "return { c: 3 }" } },
        ],
      });
      // Check context on third call — node should have s1 and s2
      const thirdCtx = executeJsFunction.mock.calls[2][1] as import("@yoizen/shared").WorkflowExecutionContext;
      expect(thirdCtx.variables.node.s1).toEqual({ accumulated: true });
      expect(thirdCtx.variables.node.s2).toEqual({ accumulated: true });
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ computed: 1 }),
      );
    });

    it("variables.workflow is empty object when workflow.variables is undefined", async () => {
      executeJsFunction.mockClear();
      const def: WorkflowDefinition = {
        name: "wf",
        tenant: "tenant-1",
        application: "orders",
        request: { orderId: "o1" },
        actions: [
          { activity: "jsFunction", name: "step", args: { code: "return 1" } },
        ],
      };
      // Ensure no variables field
      expect((def as Record<string, unknown>).variables).toBeUndefined();
      await runWorkflow(def);
      const callArgs = executeJsFunction.mock.calls[0];
      const ctx = callArgs[1] as import("@yoizen/shared").WorkflowExecutionContext;
      expect(ctx.variables.workflow).toEqual({});
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ computed: 1 }),
      );
    });
  });

  describe("context variable updates after action execution", () => {
    it("updates variables.previous after a jsFunction action", async () => {
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ computed: 42 }),
      );
      const ctx = await runWorkflow({
        ...base,
        actions: [
          { activity: "jsFunction", name: "calc", args: { code: "return { computed: 42 }" } },
        ],
      });
      expect(ctx.variables.previous).toEqual({ computed: 42 });
      expect(ctx.variables.node.calc).toEqual({ computed: 42 });
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ computed: 1 }),
      );
    });

    it("updates variables.previous after a channelSend action", async () => {
      executeChannelSend.mockClear();
      const ctx = await runWorkflow({
        ...base,
        actions: [
          {
            activity: "channelSend",
            name: "send",
            args: {
              accountId: "acc-1",
              channel: "whatsapp",
              provider: "meta",
              to: "+5491112345678",
              type: "text",
              text: "Hello",
            },
          },
        ],
      });
      expect(ctx.variables.previous).toEqual({
        published: true,
        subject: "evt.tenant-1.messaging.whatsapp.meta.send.v1",
      });
      expect(ctx.variables.node.send).toEqual({
        published: true,
        subject: "evt.tenant-1.messaging.whatsapp.meta.send.v1",
      });
    });

    it("updates variables.previous after an agentCall action", async () => {
      executeAgentCall.mockClear();
      const ctx = await runWorkflow({
        ...base,
        actions: [
          {
            activity: "agentCall",
            name: "chat",
            args: {
              agentId: "550e8400-e29b-41d4-a716-446655440000",
              message: "Hello",
            },
          },
        ],
      });
      expect(ctx.variables.previous).toEqual({
        status: 200,
        data: { reply: "agent-said" },
        headers: {},
      });
      expect(ctx.variables.node.chat).toEqual({
        status: 200,
        data: { reply: "agent-said" },
        headers: {},
      });
    });

    it("merges branch node variables into parent context", async () => {
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ branchResult: true }),
      );
      const ctx = await runWorkflow({
        ...base,
        actions: [
          {
            activity: "branch",
            name: "split",
            pathA: [
              {
                activity: "jsFunction",
                name: "aStep",
                args: { code: "return { branchA: true }" },
              },
            ],
            pathB: [
              {
                activity: "jsFunction",
                name: "bStep",
                args: { code: "return { branchB: true }" },
              },
            ],
          },
        ],
      });
      expect(ctx.variables.node.aStep).toEqual({ branchResult: true });
      expect(ctx.variables.node.bStep).toEqual({ branchResult: true });
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ computed: 1 }),
      );
    });

    it("updates variables.previous on each sequential action", async () => {
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ step: 1 }),
      );
      const ctx = await runWorkflow({
        ...base,
        actions: [
          { activity: "jsFunction", name: "s1", args: { code: "return { step: 1 }" } },
          { activity: "jsFunction", name: "s2", args: { code: "return { step: 2 }" } },
          { activity: "jsFunction", name: "s3", args: { code: "return { step: 3 }" } },
        ],
      });
      // After all actions, previous holds the last result
      expect(ctx.variables.previous).toEqual({ step: 1 });
      // All nodes are accumulated
      expect(ctx.variables.node.s1).toEqual({ step: 1 });
      expect(ctx.variables.node.s2).toEqual({ step: 1 });
      expect(ctx.variables.node.s3).toEqual({ step: 1 });
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ computed: 1 }),
      );
    });

    it("variables.node accumulates ALL action results across different activity types", async () => {
      executeJsFunction.mockImplementation(() => Promise.resolve({ val: 1 }));
      executeServiceBusCall.mockClear();
      const ctx = await runWorkflow({
        ...base,
        actions: [
          { activity: "jsFunction", name: "calc", args: { code: "return { val: 1 }" } },
          {
            activity: "serviceBusCall",
            name: "pub",
            args: { subject: "events.test" },
          },
        ],
      });
      expect(ctx.variables.node.calc).toEqual({ val: 1 });
      expect(ctx.variables.node.pub).toEqual({
        published: true,
        subject: "events.test",
      });
      // previous should be the last action's result
      expect(ctx.variables.previous).toEqual({
        published: true,
        subject: "events.test",
      });
      executeJsFunction.mockImplementation(() =>
        Promise.resolve({ computed: 1 }),
      );
    });
  });
});
