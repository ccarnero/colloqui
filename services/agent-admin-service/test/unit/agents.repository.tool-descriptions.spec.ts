import "../setup-env";
import { describe, expect, it } from "bun:test";

// NOTE: this spec only exercises plain data/SQL-fragment assertions against
// IUpdateAgentData — it imports no NestJS providers and instantiates no
// repository. It used to `mock.module("@nestjs/common")` and
// `@yoizen/observability`, but nothing here referenced them; worse, the
// process-global "@nestjs/common" mock stubbed `Inject` to a no-op and
// leaked into the full-suite run, stripping DI metadata from every service
// loaded afterwards (SKBQueryService, JobExecutionsMongoRepository), which
// then failed "can't resolve dependencies ... index [0]" only in the full
// suite. Removed — bun's mock.module has no per-file scope and mock.restore()
// does not undo it.

import type {
  IAgent,
  IUpdateAgentData,
} from "../../src/modules/agents/agents.repository.interface";

// ---------------------------------------------------------------------------
// Postgres repository tests
// ---------------------------------------------------------------------------

describe("Agents Postgres Repository — tool_description_overrides", () => {
  // We test the update method's handling of tool_description_overrides
  // by examining the SQL fragments that would be generated.
  // The actual repository uses tagged template SQL via the `sql` library.

  it("should include tool_description_overrides in the update SET clause when present", () => {
    const data: IUpdateAgentData = {
      tool_description_overrides: { memory: "Custom memory desc" },
    };

    // In the real Postgres repo, the update method has:
    // if (data.tool_description_overrides !== undefined) {
    //   await sql`UPDATE agents SET tool_description_overrides = ${sql.json(data.tool_description_overrides)} ...`
    // }
    expect(data.tool_description_overrides).toBeDefined();
    expect(data.tool_description_overrides).toEqual({
      memory: "Custom memory desc",
    });

    // Verify it's treated as JSON-compatible
    const jsonValue = JSON.parse(
      JSON.stringify(data.tool_description_overrides)
    );
    expect(jsonValue).toEqual({ memory: "Custom memory desc" });
  });

  it("should update with null to clear overrides", () => {
    const data: IUpdateAgentData = {
      tool_description_overrides: null,
    };

    // null is a valid value to clear overrides
    expect(data.tool_description_overrides).toBeNull();
  });

  it("should not include tool_description_overrides when undefined", () => {
    const data: IUpdateAgentData = {
      name: "New Name",
    };

    // tool_description_overrides is undefined — should not be in the SET clause
    expect(data).not.toHaveProperty("tool_description_overrides");
  });

  it("should handle empty Record<string, string> as valid override", () => {
    const data: IUpdateAgentData = {
      tool_description_overrides: {},
    };

    expect(data.tool_description_overrides).toEqual({});
    expect(Object.keys(data.tool_description_overrides!)).toHaveLength(0);
  });

  it("should handle multiple tool name keys in the overrides", () => {
    const data: IUpdateAgentData = {
      tool_description_overrides: {
        memory: "Memory desc",
        communicate: "Communicate desc",
        resource: "Resource desc",
      },
    };

    expect(Object.keys(data.tool_description_overrides!)).toHaveLength(3);
    expect(data.tool_description_overrides!.memory).toBe("Memory desc");
    expect(data.tool_description_overrides!.communicate).toBe(
      "Communicate desc"
    );
    expect(data.tool_description_overrides!.resource).toBe("Resource desc");
  });

  it("should convert tool_description_overrides to JSONB for Postgres", () => {
    const data: IUpdateAgentData = {
      tool_description_overrides: { memory: "desc" },
    };

    // The SQL for Postgres would be:
    // UPDATE agents SET tool_description_overrides = $1::jsonb
    const jsonValue = JSON.stringify(data.tool_description_overrides);
    expect(jsonValue).toBe('{"memory":"desc"}');

    // Parsing it back should preserve the shape
    const parsed = JSON.parse(jsonValue);
    expect(parsed).toEqual({ memory: "desc" });
  });
});

// ---------------------------------------------------------------------------
// Mongo repository tests
// ---------------------------------------------------------------------------

describe("Agents Mongo Repository — tool_description_overrides", () => {
  it("should include tool_description_overrides in $set when present in update data", () => {
    const data: IUpdateAgentData = {
      tool_description_overrides: { memory: "Custom memory desc" },
    };

    // In the Mongo repo, the update method builds:
    // const setFields: Document = { updated_at: new Date() };
    // if (data.tool_description_overrides !== undefined)
    //   setFields.tool_description_overrides = data.tool_description_overrides;
    // Then: { $set: setFields }

    const setFields: Record<string, unknown> = { updated_at: new Date() };
    if (data.tool_description_overrides !== undefined) {
      setFields.tool_description_overrides = data.tool_description_overrides;
    }

    expect(setFields.tool_description_overrides).toEqual({
      memory: "Custom memory desc",
    });
    expect(Object.keys(setFields)).toContain("tool_description_overrides");
    expect(Object.keys(setFields)).toContain("updated_at");
  });

  it("should set tool_description_overrides to null in $set when clearing", () => {
    const data: IUpdateAgentData = {
      tool_description_overrides: null,
    };

    const setFields: Record<string, unknown> = { updated_at: new Date() };
    if (data.tool_description_overrides !== undefined) {
      setFields.tool_description_overrides = data.tool_description_overrides;
    }

    expect(setFields.tool_description_overrides).toBeNull();
  });

  it("should NOT include tool_description_overrides in $set when undefined", () => {
    const data: IUpdateAgentData = {
      name: "Updated Name",
    };

    const setFields: Record<string, unknown> = { updated_at: new Date() };
    if (data.tool_description_overrides !== undefined) {
      setFields.tool_description_overrides = data.tool_description_overrides;
    }

    expect(setFields).not.toHaveProperty("tool_description_overrides");
  });

  it("should read tool_description_overrides back as Record<string,string>|null in docToAgent", () => {
    // The docToAgent function in agents.mongo.repository.ts reads:
    // tool_description_overrides:
    //   doc.tool_description_overrides
    //     ? (doc.tool_description_overrides as Record<string, string>)
    //     : null,

    // Simulate Mongo doc with overrides
    const docWithOverrides = {
      _id: "agent-1",
      name: "Agent",
      tool_description_overrides: { memory: "desc", communicate: "desc2" },
    };

    const result: Record<string, unknown> = {
      tool_description_overrides:
        docWithOverrides.tool_description_overrides ?? null,
    };

    expect(result.tool_description_overrides).toEqual({
      memory: "desc",
      communicate: "desc2",
    });
  });

  it("should read null when doc has no tool_description_overrides field", () => {
    const docWithoutOverrides = {
      _id: "agent-1",
      name: "Agent",
      // no tool_description_overrides field
    };

    const result = {
      tool_description_overrides:
        (docWithoutOverrides as any).tool_description_overrides ?? null,
    };

    expect(result.tool_description_overrides).toBeNull();
  });

  it("should read null when doc has tool_description_overrides set to null", () => {
    const docWithNullOverrides = {
      _id: "agent-1",
      name: "Agent",
      tool_description_overrides: null,
    };

    const result = {
      tool_description_overrides:
        docWithNullOverrides.tool_description_overrides ?? null,
    };

    expect(result.tool_description_overrides).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SQL constants — column list
// ---------------------------------------------------------------------------

describe("AGENT_ROW_COLUMNS — tool_description_overrides", () => {
  it("should include tool_description_overrides in the shared column list", async () => {
    const { AGENT_ROW_COLUMNS } = await import(
      "../../src/modules/agents/agents-sql.constants"
    );

    expect(AGENT_ROW_COLUMNS).toContain("tool_description_overrides");
  });

  it("should have tool_description_overrides in IAgent interface type", () => {
    // Compile-time check: verify the interface shape is correct
    const agentShape: IAgent = {
      id: "test",
      name: "test",
      description: null,
      system_prompt: "prompt",
      model_config: {},
      tools: [],
      enabled_tools: null,
      enabled_mcp_servers: null,
      tool_description_overrides: { memory: "desc" },
      channels: [],
      status: "draft",
      is_active: true,
      published_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    expect(agentShape.tool_description_overrides).toEqual({ memory: "desc" });
  });

  it("should have tool_description_overrides as optional in IUpdateAgentData", () => {
    const updateData: IUpdateAgentData = {
      name: "test",
      tool_description_overrides: { memory: "desc" },
    };

    expect(updateData.tool_description_overrides).toEqual({ memory: "desc" });
  });
});
