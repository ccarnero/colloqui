import "../../setup-env";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { Workflow } from "@yoizen/shared";
import { createWorkflowsWriter } from "../../../src/modules/apply/infrastructure/workflows-writer";

const BASE_URL = "http://workflow-service.local";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createWorkflowsWriter", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("create: fails loud when definition.application is missing", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("must never call the network without application");
    }) as unknown as typeof fetch;

    const writer = createWorkflowsWriter(BASE_URL);
    const workflow: Workflow = {
      name: "e2e-flow",
      definition: { actions: [{ type: "jsFunction", code: "() => {}" }] },
    };

    const result = await writer.create("tenant-a", workflow);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("missing_required_field");
    }
  });

  it("create: fails loud when definition.actions is missing or empty", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("must never call the network without actions");
    }) as unknown as typeof fetch;

    const writer = createWorkflowsWriter(BASE_URL);
    const workflow: Workflow = {
      name: "e2e-flow",
      definition: { application: "e2e", actions: [] },
    };

    const result = await writer.create("tenant-a", workflow);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("missing_required_field");
    }
  });

  it("create: application + non-empty actions -> POST /workflows", async () => {
    let capturedBody: unknown;
    globalThis.fetch = mock(async (_url, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return json({ id: "wf-1" }, 201);
    }) as unknown as typeof fetch;

    const writer = createWorkflowsWriter(BASE_URL);
    const workflow: Workflow = {
      name: "e2e-flow",
      definition: {
        application: "e2e",
        actions: [{ type: "jsFunction", code: "() => 1" }],
      },
    };

    const result = await writer.create("tenant-a", workflow);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.externalId).toBe("wf-1");
    }
    expect(capturedBody).toMatchObject({
      name: "e2e-flow",
      application: "e2e",
    });
  });

  it("update: existence-only kind — never exercised, safe no-op", async () => {
    const writer = createWorkflowsWriter(BASE_URL);
    const workflow: Workflow = {
      name: "e2e-flow",
      definition: { application: "e2e", actions: [] },
    };
    const result = await writer.update("tenant-a", "wf-1", workflow, []);
    expect(result.ok).toBe(true);
  });
});
