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
});
