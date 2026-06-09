import "reflect-metadata";
import { describe, it, expect } from "bun:test";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
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
            channel: "whatsapp",
            provider: "meta",
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
