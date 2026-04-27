import { describe, it, expect, afterAll } from "bun:test";
import { getBaseUrl, httpPost, httpGet, httpDelete, poll } from "./helpers";
import { authHeaders } from "./auth.setup";

const GW = getBaseUrl("api-gateway");

/**
 * Tests that drive a workflow execution must wait on the Temporal worker
 * pipeline (`workflow-service-api` enqueues, `workflow-worker` processes
 * activities). With scale-to-zero enabled in non-prod, both can be cold;
 * budget is sized for sequential cold-starts of api + worker + the first
 * activity batch.
 */
const WORKFLOW_IT = { timeout: 120_000 };

const createdDefinitionIds: string[] = [];

afterAll(async () => {
  const h = await authHeaders();
  for (const id of createdDefinitionIds) {
    await httpDelete(`${GW}/workflows/${id}`, { headers: h });
  }
});

interface WorkflowDefinitionCreated {
  id: string;
  name: string;
  application: string;
  tenantId: string;
  actions: unknown;
  createdAt: string;
}

interface ExecuteWorkflowResult {
  executionId: string;
  definitionId: string;
  temporalWorkflowId: string;
  runId: string;
}

interface ExecutionStatus {
  executionId: string;
  definitionId: string;
  temporalWorkflowId: string;
  status: string;
  result?: {
    workflow: { name: string; tenant: string; application: string };
    request: Record<string, unknown>;
    results: Record<string, unknown>;
  };
  createdAt: string;
}

async function pollExecution(
  definitionId: string,
  executionId: string,
  timeoutMs = 60_000,
): Promise<ExecutionStatus> {
  const h = await authHeaders();
  return poll<ExecutionStatus>(
    async () => {
      const res = await httpGet<ExecutionStatus>(
        `${GW}/workflows/${definitionId}/executions/${executionId}`,
        { headers: h },
      );
      if (res.status !== 200) {
        return null;
      }
      if (
        res.body.status === "COMPLETED" ||
        res.body.status === "FAILED"
      ) {
        return res.body;
      }
      return null;
    },
    { timeoutMs, initialDelayMs: 500, maxDelayMs: 3_000 },
  );
}

describe("E2E: workflow-service", () => {
  let definitionId: string;
  let firstExecutionId: string;

  it("should create a workflow definition without executing", async () => {
    const h = await authHeaders();
    const { status, body } = await httpPost<WorkflowDefinitionCreated>(
      `${GW}/workflows`,
      {
        name: `e2e-workflow-${Date.now()}`,
        application: "e2e-tests",
        actions: [
          {
            activity: "jsFunction",
            name: "greet",
            args: { code: '(ctx) => ({ greeting: "hello from e2e" })' },
          },
        ],
      },
      { headers: h },
    );

    expect(status).toBe(201);
    expect(body.id).toBeDefined();
    expect(body.name).toContain("e2e-workflow-");
    expect(body.application).toBe("e2e-tests");
    definitionId = body.id;
    createdDefinitionIds.push(body.id);
  });

  it("should create a workflow definition with agentCall action (validation only)", async () => {
    const h = await authHeaders();
    const { status, body } = await httpPost<WorkflowDefinitionCreated>(
      `${GW}/workflows`,
      {
        name: `e2e-agentcall-${Date.now()}`,
        application: "e2e-tests",
        actions: [
          {
            activity: "agentCall",
            name: "claw",
            args: {
              agentId: "550e8400-e29b-41d4-a716-446655440000",
              message: "Summarize: {{results.prior.data}}",
            },
          },
        ],
      },
      { headers: h },
    );

    expect(status).toBe(201);
    expect(body.id).toBeDefined();
    createdDefinitionIds.push(body.id);
  });

  it("should list workflow definitions", async () => {
    const h = await authHeaders();
    const { status, body } = await httpGet<WorkflowDefinitionCreated[]>(
      `${GW}/workflows`,
      { headers: h },
    );

    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.some((d) => d.id === definitionId)).toBe(true);
  });

  it("should get a workflow definition by id", async () => {
    if (!definitionId) {
      return;
    }
    const h = await authHeaders();
    const { status, body } = await httpGet<WorkflowDefinitionCreated>(
      `${GW}/workflows/${definitionId}`,
      { headers: h },
    );

    expect(status).toBe(200);
    expect(body.id).toBe(definitionId);
    expect(body.application).toBe("e2e-tests");
  });

  it("should execute a workflow definition", async () => {
    if (!definitionId) {
      return;
    }
    const h = await authHeaders();
    const { status, body } = await httpPost<ExecuteWorkflowResult>(
      `${GW}/workflows/${definitionId}/execute`,
      { request: { input: "hello" } },
      { headers: h },
    );

    expect(status).toBe(202);
    expect(body.executionId).toBeDefined();
    expect(body.definitionId).toBe(definitionId);
    expect(body.temporalWorkflowId).toBeDefined();
    expect(body.runId).toBeDefined();
    firstExecutionId = body.executionId;
  });

  it(
    "should poll execution until completion",
    async () => {
      if (!definitionId || !firstExecutionId) {
        return;
      }

      const result = await pollExecution(definitionId, firstExecutionId);

      expect(result.executionId).toBe(firstExecutionId);
      expect(result.definitionId).toBe(definitionId);
      expect(result.status).toBe("COMPLETED");
    },
    WORKFLOW_IT.timeout,
  );

  it(
    "should execute the same workflow a second time",
    async () => {
      if (!definitionId) {
        return;
      }
      const h = await authHeaders();
      const { status, body } = await httpPost<ExecuteWorkflowResult>(
        `${GW}/workflows/${definitionId}/execute`,
        { request: { input: "second run" } },
        { headers: h },
      );

      expect(status).toBe(202);
      expect(body.executionId).toBeDefined();
      expect(body.executionId).not.toBe(firstExecutionId);
      expect(body.definitionId).toBe(definitionId);

      const result = await pollExecution(definitionId, body.executionId);
      expect(result.status).toBe("COMPLETED");
    },
    WORKFLOW_IT.timeout,
  );

  it("should list executions for a definition", async () => {
    if (!definitionId) {
      return;
    }
    const h = await authHeaders();
    const { status, body } = await httpGet<unknown[]>(
      `${GW}/workflows/${definitionId}/executions`,
      { headers: h },
    );

    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(2);
  });

  it("should soft-delete a workflow definition", async () => {
    if (!definitionId) {
      return;
    }
    const h = await authHeaders();
    const { status } = await httpDelete(
      `${GW}/workflows/${definitionId}`,
      { headers: h },
    );

    expect(status).toBe(204);
  });

  it("should return 404 for a deleted definition", async () => {
    if (!definitionId) {
      return;
    }
    const h = await authHeaders();
    const { status } = await httpGet(
      `${GW}/workflows/${definitionId}`,
      { headers: h },
    );

    expect(status).toBe(404);
  });

  it("should return 404 for a nonexistent definition", async () => {
    const h = await authHeaders();
    const { status } = await httpGet(
      `${GW}/workflows/nonexistent-e2e-wf`,
      { headers: h },
    );

    expect(status).toBe(404);
  });
});
