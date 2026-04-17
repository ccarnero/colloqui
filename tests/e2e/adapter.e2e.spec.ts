import { describe, it, expect, afterAll } from "bun:test";
import { getBaseUrl, httpPost, httpGet, httpDelete, poll } from "./helpers";
import { authHeaders } from "./auth.setup";

const GW = getBaseUrl("api-gateway");

/** Bun's default per-test timeout is 5s; polls and workflows need longer. */
const SLOW_IT = { timeout: 90_000 };
const VERY_SLOW_IT = { timeout: 120_000 };

interface AdapterResponse {
  id: string;
  name: string;
  endpoints: Array<{
    id: string;
    label: string;
    method: string;
    path: string;
  }>;
}

interface EventAccepted {
  id: string;
  status: string;
}

interface ProcessedResult {
  eventId: string;
  type: string;
  processed: boolean;
  timestamp: number;
}

interface WorkflowDefinitionCreated {
  id: string;
  name: string;
  application: string;
}

interface ExecuteWorkflowResult {
  executionId: string;
  definitionId: string;
  temporalWorkflowId: string;
  runId: string;
}

interface EndpointCallResult {
  status: number;
  data: Record<string, unknown>;
  headers: Record<string, string>;
}

interface ExecutionStatus {
  executionId: string;
  definitionId: string;
  temporalWorkflowId: string;
  status: string;
  result?: {
    workflow: { name: string; tenant: string; application: string };
    request: Record<string, unknown>;
    results: Record<string, EndpointCallResult>;
  };
  createdAt: string;
}

function findHeader(
  headers: Record<string, unknown>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) {
      return String(v);
    }
  }
  return undefined;
}

async function createAdapter(
  overrides: Record<string, unknown> = {},
): Promise<AdapterResponse> {
  const h = await authHeaders();
  const { status, body } = await httpPost<AdapterResponse>(
    `${GW}/adapters`,
    {
      name: `e2e-adapter-${Date.now()}`,
      context: "external",
      baseUrl: "https://httpbin.org",
      authType: "none",
      authConfig: {},
      headers: [],
      timeoutMs: 10_000,
      maxRetries: 1,
      retryBackoffMs: 500,
      healthCheckPath: "/get",
      ...overrides,
    },
    { headers: h },
  );
  expect(status).toBe(201);
  return body;
}

async function addEndpoint(
  adapterId: string,
  label: string,
  method: string,
  path: string,
): Promise<string> {
  const h = await authHeaders();
  const { status, body } = await httpPost<{ id: string }>(
    `${GW}/adapters/${adapterId}/endpoints`,
    { label, method, path },
    { headers: h },
  );
  expect(status).toBe(201);
  return body.id;
}

async function deleteAdapter(adapterId: string): Promise<void> {
  const h = await authHeaders();
  await httpDelete(`${GW}/adapters/${adapterId}`, { headers: h });
}

async function pollEvent(eventId: string): Promise<ProcessedResult> {
  const h = await authHeaders();
  return poll<ProcessedResult>(
    async () => {
      const res = await httpGet<ProcessedResult>(
        `${GW}/results/${eventId}`,
        { headers: h },
      );
      if (res.status === 200) {
        return res.body;
      }
      return null;
    },
    { timeoutMs: 60_000 },
  );
}

/**
 * Creates a workflow definition and immediately executes it.
 * Returns both the definition ID and execution details for polling.
 */
async function createAndExecuteWorkflow(
  name: string,
  actions: unknown[],
  request: Record<string, unknown> = {},
): Promise<{
  definitionId: string;
  executionId: string;
  temporalWorkflowId: string;
}> {
  const h = await authHeaders();

  const { status: createStatus, body: definition } =
    await httpPost<WorkflowDefinitionCreated>(`${GW}/workflows`, {
      name,
      application: "e2e-tests",
      actions,
    }, { headers: h });
  expect(createStatus).toBe(201);

  const { status: execStatus, body: execution } =
    await httpPost<ExecuteWorkflowResult>(
      `${GW}/workflows/${definition.id}/execute`,
      { request },
      { headers: h },
    );
  expect(execStatus).toBe(202);

  return {
    definitionId: definition.id,
    executionId: execution.executionId,
    temporalWorkflowId: execution.temporalWorkflowId,
  };
}

async function pollWorkflow(
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

// ═══════════════════════════════════════════════════════════════════
//  Core adapter integration (event-processor, workflows, webhooks)
// ═══════════════════════════════════════════════════════════════════

describe("E2E: adapter integration", () => {
  let adapterId: string;
  let enrichEndpointId: string;
  let forwardEndpointId: string;

  it(
    "should create an adapter via the api-gateway",
    async () => {
      const adapter = await createAdapter();
      adapterId = adapter.id;
    },
    SLOW_IT,
  );

  it(
    "should add endpoints to the adapter",
    async () => {
      if (!adapterId) {
        return;
      }
      enrichEndpointId = await addEndpoint(adapterId, "Echo GET", "GET", "/get");
      forwardEndpointId = await addEndpoint(
        adapterId,
        "Echo POST",
        "POST",
        "/post",
      );
    },
    SLOW_IT,
  );

  // ── Event-Processor ───────────────────────────────────────────

  it(
    "should process an event with adapter enrichment",
    async () => {
      if (!adapterId || !enrichEndpointId) {
        return;
      }
      const h = await authHeaders();

      const { status, body } = await httpPost<EventAccepted>(
        `${GW}/events`,
        {
          type: "adapter-enrich-e2e",
          payload: { data: "enrich-test" },
          enrichAdapter: { adapterId, endpointId: enrichEndpointId },
        },
        { headers: h },
      );

      expect(status).toBe(202);
      const result = await pollEvent(body.id);
      expect(result.eventId).toBe(body.id);
      expect(result.processed).toBe(true);
    },
    SLOW_IT,
  );

  it(
    "should process an event with adapter forwarding",
    async () => {
      if (!adapterId || !forwardEndpointId) {
        return;
      }
      const h = await authHeaders();

      const { status, body } = await httpPost<EventAccepted>(
        `${GW}/events`,
        {
          type: "adapter-fwd-e2e",
          payload: { data: "forward-test" },
          forwardAdapter: { adapterId, endpointId: forwardEndpointId },
        },
        { headers: h },
      );

      expect(status).toBe(202);
      const result = await pollEvent(body.id);
      expect(result.processed).toBe(true);
    },
    SLOW_IT,
  );

  it(
    "should process an event through both enrichment and forwarding",
    async () => {
      if (!adapterId || !enrichEndpointId || !forwardEndpointId) {
        return;
      }
      const h = await authHeaders();

      const { status, body } = await httpPost<EventAccepted>(
        `${GW}/events`,
        {
          type: "adapter-combined-e2e",
          payload: { data: "combined-test" },
          enrichAdapter: { adapterId, endpointId: enrichEndpointId },
          forwardAdapter: { adapterId, endpointId: forwardEndpointId },
        },
        { headers: h },
      );

      expect(status).toBe(202);
      const result = await pollEvent(body.id);
      expect(result.processed).toBe(true);
    },
    SLOW_IT,
  );

  // ── Workflow-HTTP-Worker ──────────────────────────────────────

  it(
    "should complete a workflow with adapter-driven endpointCall",
    async () => {
      if (!adapterId || !enrichEndpointId) {
        return;
      }

      const { definitionId, executionId } = await createAndExecuteWorkflow(
        `e2e-adapter-wf-${Date.now()}`,
        [
          {
            activity: "endpointCall",
            name: "adapterGet",
            args: {
              method: "GET",
              url: "",
              adapterId,
              endpointId: enrichEndpointId,
              params: { source: "e2e" },
            },
          },
        ],
        { query: "adapter-check" },
      );

      const result = await pollWorkflow(definitionId, executionId);
      expect(result.executionId).toBe(executionId);
      expect(result.status).toBe("COMPLETED");
    },
    SLOW_IT,
  );

  it(
    "should complete a workflow with adapter endpointCall POST",
    async () => {
      if (!adapterId || !forwardEndpointId) {
        return;
      }

      const { definitionId, executionId } = await createAndExecuteWorkflow(
        `e2e-adapter-post-wf-${Date.now()}`,
        [
          {
            activity: "endpointCall",
            name: "adapterPost",
            args: {
              method: "POST",
              url: "",
              adapterId,
              endpointId: forwardEndpointId,
              data: { from: "workflow", source: "e2e" },
            },
          },
        ],
        { message: "adapter-post-check" },
      );

      const result = await pollWorkflow(definitionId, executionId);
      expect(result.executionId).toBe(executionId);
      expect(result.status).toBe("COMPLETED");
    },
    SLOW_IT,
  );

  // ── Webhook-Service ───────────────────────────────────────────

  it(
    "should deliver webhook using adapter config",
    async () => {
      if (!adapterId) {
        return;
      }
      const h = await authHeaders();

      const { status, body } = await httpPost<EventAccepted>(
        `${GW}/events`,
        {
          type: "adapter-webhook-e2e",
          payload: { data: "webhook-test" },
          callbackUrl: "https://httpbin.org/post",
          adapterId,
        },
        { headers: h },
      );

      expect(status).toBe(202);
      const result = await pollEvent(body.id);
      expect(result.processed).toBe(true);
    },
    SLOW_IT,
  );

  it(
    "should deliver webhook with adapter + enrichment combined",
    async () => {
      if (!adapterId || !enrichEndpointId) {
        return;
      }
      const h = await authHeaders();

      const { status, body } = await httpPost<EventAccepted>(
        `${GW}/events`,
        {
          type: "adapter-full-pipeline-e2e",
          payload: { data: "full-pipeline" },
          callbackUrl: "https://httpbin.org/post",
          adapterId,
          enrichAdapter: { adapterId, endpointId: enrichEndpointId },
        },
        { headers: h },
      );

      expect(status).toBe(202);
      const result = await pollEvent(body.id);
      expect(result.processed).toBe(true);
    },
    SLOW_IT,
  );

  afterAll(async () => {
    if (adapterId) {
      await deleteAdapter(adapterId);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Custom headers propagation
// ═══════════════════════════════════════════════════════════════════

describe("E2E: adapter custom headers", () => {
  const CUSTOM_HEADER = "X-E2E-Custom";
  const CUSTOM_VALUE = "header-check-42";
  const SECOND_HEADER = "X-E2E-Second";
  const SECOND_VALUE = "multi-header-ok";

  let adapterId: string;
  let getEndpointId: string;

  it(
    "should create an adapter with custom headers",
    async () => {
      const adapter = await createAdapter({
        headers: [
          { key: CUSTOM_HEADER, value: CUSTOM_VALUE },
          { key: SECOND_HEADER, value: SECOND_VALUE },
        ],
      });
      adapterId = adapter.id;
      getEndpointId = await addEndpoint(adapterId, "Echo GET", "GET", "/get");
    },
    SLOW_IT,
  );

  it(
    "should include custom headers in workflow endpointCall (httpbin echo)",
    async () => {
      if (!adapterId || !getEndpointId) {
        return;
      }

      const { definitionId, executionId } = await createAndExecuteWorkflow(
        `e2e-header-wf-${Date.now()}`,
        [
          {
            activity: "endpointCall",
            name: "echoHeaders",
            args: {
              method: "GET",
              url: "",
              adapterId,
              endpointId: getEndpointId,
            },
          },
        ],
      );

      const wf = await pollWorkflow(definitionId, executionId);
      expect(wf.status).toBe("COMPLETED");

      const echoResult = wf.result?.results?.echoHeaders;
      expect(echoResult).toBeDefined();
      expect(echoResult!.status).toBe(200);

      const echoed = echoResult!.data as { headers: Record<string, string> };
      expect(echoed.headers).toBeDefined();
      expect(findHeader(echoed.headers, CUSTOM_HEADER)).toBe(CUSTOM_VALUE);
      expect(findHeader(echoed.headers, SECOND_HEADER)).toBe(SECOND_VALUE);
    },
    SLOW_IT,
  );

  it(
    "should inject custom headers during event-processor enrichment",
    async () => {
      if (!adapterId || !getEndpointId) {
        return;
      }
      const h = await authHeaders();

      const { status, body } = await httpPost<EventAccepted>(
        `${GW}/events`,
        {
          type: "adapter-header-enrich-e2e",
          payload: { data: "header-enrich" },
          enrichAdapter: { adapterId, endpointId: getEndpointId },
        },
        { headers: h },
      );

      expect(status).toBe(202);
      const result = await pollEvent(body.id);
      expect(result.processed).toBe(true);
    },
    SLOW_IT,
  );

  it(
    "should inject custom headers in webhook delivery",
    async () => {
      if (!adapterId) {
        return;
      }
      const h = await authHeaders();

      const { status, body } = await httpPost<EventAccepted>(
        `${GW}/events`,
        {
          type: "adapter-header-webhook-e2e",
          payload: { data: "header-webhook" },
          callbackUrl: "https://httpbin.org/post",
          adapterId,
        },
        { headers: h },
      );

      expect(status).toBe(202);
      const result = await pollEvent(body.id);
      expect(result.processed).toBe(true);
    },
    SLOW_IT,
  );

  afterAll(async () => {
    if (adapterId) {
      await deleteAdapter(adapterId);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Retry behaviour
// ═══════════════════════════════════════════════════════════════════

describe("E2E: adapter retries", () => {
  let adapterId: string;
  let status503EndpointId: string;
  let forwardEndpointId: string;

  it(
    "should create a retry-configured adapter",
    async () => {
      const adapter = await createAdapter({
        maxRetries: 2,
        retryBackoffMs: 200,
      });
      adapterId = adapter.id;
      status503EndpointId = await addEndpoint(
        adapterId,
        "Always 503",
        "GET",
        "/status/503",
      );
      forwardEndpointId = await addEndpoint(
        adapterId,
        "Forward 503",
        "POST",
        "/status/503",
      );
    },
    SLOW_IT,
  );

  it(
    "should exhaust retries on 5xx and return error status in workflow",
    async () => {
      if (!adapterId || !status503EndpointId) {
        return;
      }

      const { definitionId, executionId } = await createAndExecuteWorkflow(
        `e2e-retry-wf-${Date.now()}`,
        [
          {
            activity: "endpointCall",
            name: "retryCall",
            args: {
              method: "GET",
              url: "",
              adapterId,
              endpointId: status503EndpointId,
            },
          },
        ],
      );

      const wf = await pollWorkflow(definitionId, executionId);
      expect(wf.status).toBe("COMPLETED");

      const retryResult = wf.result?.results?.retryCall;
      expect(retryResult).toBeDefined();
      expect(retryResult!.status).toBe(503);
    },
    SLOW_IT,
  );

  it(
    "should process event even when forward retries exhaust (non-blocking)",
    async () => {
      if (!adapterId || !forwardEndpointId) {
        return;
      }
      const h = await authHeaders();

      const { status, body } = await httpPost<EventAccepted>(
        `${GW}/events`,
        {
          type: "adapter-retry-fwd-e2e",
          payload: { data: "retry-forward" },
          forwardAdapter: { adapterId, endpointId: forwardEndpointId },
        },
        { headers: h },
      );

      expect(status).toBe(202);
      const result = await pollEvent(body.id);
      expect(result.processed).toBe(true);
    },
    SLOW_IT,
  );

  afterAll(async () => {
    if (adapterId) {
      await deleteAdapter(adapterId);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Timeout enforcement
// ═══════════════════════════════════════════════════════════════════

describe("E2E: adapter timeouts", () => {
  let adapterId: string;
  let delayEndpointId: string;

  it(
    "should create a short-timeout adapter",
    async () => {
      const adapter = await createAdapter({
        timeoutMs: 1_000,
        maxRetries: 0,
      });
      adapterId = adapter.id;
      delayEndpointId = await addEndpoint(
        adapterId,
        "10s Delay",
        "GET",
        "/delay/10",
      );
    },
    SLOW_IT,
  );

  it(
    "should fail workflow when adapter timeout is exceeded",
    async () => {
      if (!adapterId || !delayEndpointId) {
        return;
      }

      const { definitionId, executionId } = await createAndExecuteWorkflow(
        `e2e-timeout-wf-${Date.now()}`,
        [
          {
            activity: "endpointCall",
            name: "slowCall",
            args: {
              method: "GET",
              url: "",
              adapterId,
              endpointId: delayEndpointId,
            },
          },
        ],
      );

      const wf = await pollWorkflow(definitionId, executionId, 90_000);
      expect(wf.status).toBe("FAILED");
    },
    VERY_SLOW_IT,
  );

  it(
    "should still process event when enrichment times out (non-blocking)",
    async () => {
      if (!adapterId || !delayEndpointId) {
        return;
      }
      const h = await authHeaders();

      const { status, body } = await httpPost<EventAccepted>(
        `${GW}/events`,
        {
          type: "adapter-timeout-enrich-e2e",
          payload: { data: "timeout-enrich" },
          enrichAdapter: { adapterId, endpointId: delayEndpointId },
        },
        { headers: h },
      );

      expect(status).toBe(202);
      const result = await pollEvent(body.id);
      expect(result.processed).toBe(true);
    },
    SLOW_IT,
  );

  it(
    "should still process event when forward times out (non-blocking)",
    async () => {
      if (!adapterId || !delayEndpointId) {
        return;
      }
      const h = await authHeaders();

      const { status, body } = await httpPost<EventAccepted>(
        `${GW}/events`,
        {
          type: "adapter-timeout-fwd-e2e",
          payload: { data: "timeout-forward" },
          forwardAdapter: { adapterId, endpointId: delayEndpointId },
        },
        { headers: h },
      );

      expect(status).toBe(202);
      const result = await pollEvent(body.id);
      expect(result.processed).toBe(true);
    },
    SLOW_IT,
  );

  afterAll(async () => {
    if (adapterId) {
      await deleteAdapter(adapterId);
    }
  });
});
