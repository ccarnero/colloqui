import "reflect-metadata";
import { describe, expect, it } from "bun:test";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateWorkflowDto } from "../../src/modules/workflows/dto/create-workflow.dto";

describe("IsWorkflowActionArrayConstraint", () => {
  it("accepts valid mixed actions including branch", async () => {
    const dto = plainToInstance(CreateWorkflowDto, {
      name: "w",
      application: "app",
      actions: [
        {
          activity: "endpointCall",
          name: "http1",
          args: { method: "GET", url: "https://x" },
        },
        {
          activity: "jsFunction",
          name: "js",
          args: { code: "return 1" },
        },
        {
          activity: "serviceBusCall",
          name: "bus",
          args: { subject: "subj" },
        },
        {
          activity: "branch",
          name: "br",
          left: [
            {
              activity: "jsFunction",
              name: "inner",
              args: { code: "return 2" },
            },
          ],
        },
      ],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("rejects empty actions array", async () => {
    const dto = plainToInstance(CreateWorkflowDto, {
      name: "w",
      application: "app",
      actions: [],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects unknown activity", async () => {
    const dto = plainToInstance(CreateWorkflowDto, {
      name: "w",
      application: "app",
      actions: [{ activity: "unknown", name: "n", args: {} }],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects an activity kind not in the accepted discriminator set", async () => {
    const dto = plainToInstance(CreateWorkflowDto, {
      name: "w",
      application: "app",
      actions: [{ activity: "sleep", name: "n", args: { ms: 1000 } }],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("accepts exactly the documented set of activity kinds and nothing else", async () => {
    // Doc-pinned set (K4): endpointCall, mcpCall, jsFunction, serviceBusCall,
    // serviceCall, channelSend, agentCall, branch, conditional.
    const acceptedActions: Record<string, unknown> = {
      endpointCall: {
        activity: "endpointCall",
        name: "n",
        args: { method: "GET", url: "https://x" },
      },
      mcpCall: {
        activity: "mcpCall",
        name: "n",
        args: { serverId: "srv-1", toolName: "tool-1" },
      },
      jsFunction: {
        activity: "jsFunction",
        name: "n",
        args: { code: "return 1" },
      },
      serviceBusCall: {
        activity: "serviceBusCall",
        name: "n",
        args: { subject: "subj" },
      },
      serviceCall: {
        activity: "serviceCall",
        name: "n",
        args: { serviceId: "svc-1", method: "GET", path: "/x" },
      },
      channelSend: {
        activity: "channelSend",
        name: "n",
        args: {
          accountId: "acc-1",
          channel: "telegram",
          provider: "telegram",
          to: "+1",
          type: "text",
        },
      },
      agentCall: {
        activity: "agentCall",
        name: "n",
        args: { agentId: "a1", message: "hi" },
      },
      branch: {
        activity: "branch",
        name: "n",
        left: [{ activity: "jsFunction", name: "inner", args: { code: "1" } }],
      },
      conditional: {
        activity: "conditional",
        name: "n",
        branches: [
          {
            label: "ok",
            condition: { variable: "x", comparator: "eq", value: "y" },
            actions: [],
          },
        ],
      },
    };

    const acceptedKinds = Object.keys(acceptedActions);
    expect(acceptedKinds.sort()).toEqual(
      [
        "endpointCall",
        "mcpCall",
        "jsFunction",
        "serviceBusCall",
        "serviceCall",
        "channelSend",
        "agentCall",
        "branch",
        "conditional",
      ].sort()
    );

    for (const kind of acceptedKinds) {
      const dto = plainToInstance(CreateWorkflowDto, {
        name: "w",
        application: "app",
        actions: [acceptedActions[kind]],
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    }

    // Anything outside that set must be rejected.
    for (const unknownKind of ["sleep", "delay", "httpCall", "email"]) {
      const dto = plainToInstance(CreateWorkflowDto, {
        name: "w",
        application: "app",
        actions: [{ activity: unknownKind, name: "n", args: {} }],
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it("accepts agentCall action", async () => {
    const dto = plainToInstance(CreateWorkflowDto, {
      name: "w",
      application: "app",
      actions: [
        {
          activity: "agentCall",
          name: "chat",
          args: {
            agentId: "a1",
            message: "Summarize {{results.prev.data}}",
          },
        },
      ],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("rejects agentCall with empty message", async () => {
    const dto = plainToInstance(CreateWorkflowDto, {
      name: "w",
      application: "app",
      actions: [
        {
          activity: "agentCall",
          name: "chat",
          args: { agentId: "a1", message: "" },
        },
      ],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("accepts channelSend action", async () => {
    const dto = plainToInstance(CreateWorkflowDto, {
      name: "w",
      application: "app",
      actions: [
        {
          activity: "channelSend",
          name: "send",
          args: {
            accountId: "acc-1",
            channel: "telegram",
            provider: "telegram",
            to: "{{request.from}}",
            type: "text",
            text: "Hello",
          },
        },
      ],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("rejects the historically-fabricated channelSend email shape", async () => {
    // This shape ({activity, name, args:{channel, recipient, subject, body}})
    // was never a real WorkflowAction — the doc was wrong. K4 pins that the
    // validator still rejects it: `isChannelSendArgs` requires
    // accountId/channel/provider/to/type, not recipient/subject/body.
    const dto = plainToInstance(CreateWorkflowDto, {
      name: "w",
      application: "app",
      actions: [
        {
          activity: "channelSend",
          name: "notify",
          args: {
            channel: "email",
            recipient: "user@example.com",
            subject: "Hello",
            body: "World",
          },
        },
      ],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("accepts a valid telegram channelSend with the real required fields", async () => {
    const dto = plainToInstance(CreateWorkflowDto, {
      name: "w",
      application: "app",
      actions: [
        {
          activity: "channelSend",
          name: "notify",
          args: {
            accountId: "acc-1",
            channel: "telegram",
            provider: "telegram",
            to: "+5491100000000",
            type: "text",
          },
        },
      ],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("accepts mcpCall with serverId and toolName", async () => {
    const dto = plainToInstance(CreateWorkflowDto, {
      name: "w",
      application: "app",
      actions: [
        {
          activity: "mcpCall",
          name: "call-tool",
          args: { serverId: "srv-1", toolName: "search" },
        },
      ],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("accepts mcpCall with optional params alongside serverId/toolName", async () => {
    const dto = plainToInstance(CreateWorkflowDto, {
      name: "w",
      application: "app",
      actions: [
        {
          activity: "mcpCall",
          name: "call-tool",
          args: {
            serverId: "srv-1",
            toolName: "search",
            params: { query: "{{request.q}}" },
          },
        },
      ],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("rejects mcpCall missing serverId", async () => {
    const dto = plainToInstance(CreateWorkflowDto, {
      name: "w",
      application: "app",
      actions: [
        {
          activity: "mcpCall",
          name: "call-tool",
          args: { toolName: "search" },
        },
      ],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects mcpCall missing toolName", async () => {
    const dto = plainToInstance(CreateWorkflowDto, {
      name: "w",
      application: "app",
      actions: [
        {
          activity: "mcpCall",
          name: "call-tool",
          args: { serverId: "srv-1" },
        },
      ],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects branch with no child arrays", async () => {
    const dto = plainToInstance(CreateWorkflowDto, {
      name: "w",
      application: "app",
      actions: [{ activity: "branch", name: "b" }],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("accepts conditional action with valid branches", async () => {
    const dto = plainToInstance(CreateWorkflowDto, {
      name: "w",
      application: "app",
      actions: [
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
                  name: "step",
                  args: { code: "return 1" },
                },
              ],
            },
          ],
        },
      ],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("accepts conditional action with default", async () => {
    const dto = plainToInstance(CreateWorkflowDto, {
      name: "w",
      application: "app",
      actions: [
        {
          activity: "conditional",
          name: "route",
          branches: [
            {
              label: "ok",
              condition: {
                variable: "results.prev.status",
                comparator: "eq",
                value: "ok",
              },
              actions: [],
            },
          ],
          default: [
            {
              activity: "jsFunction",
              name: "fallback",
              args: { code: "return 0" },
            },
          ],
        },
      ],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("rejects conditional action with empty branches", async () => {
    const dto = plainToInstance(CreateWorkflowDto, {
      name: "w",
      application: "app",
      actions: [
        {
          activity: "conditional",
          name: "route",
          branches: [],
        },
      ],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects conditional action with missing condition fields", async () => {
    const dto = plainToInstance(CreateWorkflowDto, {
      name: "w",
      application: "app",
      actions: [
        {
          activity: "conditional",
          name: "route",
          branches: [
            {
              label: "bad",
              condition: { variable: "", comparator: "eq", value: "" },
              actions: [],
            },
          ],
        },
      ],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
