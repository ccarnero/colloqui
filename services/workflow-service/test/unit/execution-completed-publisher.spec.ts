import "reflect-metadata";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { isCompliantEnvelope } from "@yoizen/shared";
import actionCompletedFixture from "../../../../fixtures/bus-events/workflow-service-action-completed-envelope-01.json";
import actionStartedFixture from "../../../../fixtures/bus-events/workflow-service-action-started-envelope-01.json";
import conditionEvaluatedFixture from "../../../../fixtures/bus-events/workflow-service-condition-evaluated-envelope-01.json";
import executionStartedFixture from "../../../../fixtures/bus-events/workflow-service-execution-started-envelope-01.json";

/**
 * Ensures the async-projection emitter for workflow execution
 * completion publishes a canonical CloudEvents envelope to
 * `INGRESS-<tenant>` under the canonical 8-token subject, sets
 * `Nats-Msg-Id` for dedup, and gracefully no-ops when no tenantId
 * is provided (preserving the old best-effort contract).
 */
const mockFlush = mock(() => Promise.resolve());
const mockPublish = mock(() => undefined);
const mockHeaderSet = mock((_k: string, _v: string) => undefined);

const mockConn = {
  isClosed: () => false,
  publish: mockPublish,
  flush: mockFlush,
};

const connectMock = mock(() => Promise.resolve(mockConn));

mock.module("nats", () => ({
  connect: connectMock,
  headers: () => ({ set: mockHeaderSet }),
}));

mock.module("@yoizen/observability", () => ({
  activeOrRandomTraceId: () => "trace-test",
  injectTraceContext: () => undefined,
  startNatsProducerSpan: () => ({ span: { end() {} } }),
  tracedFetch: mock(
    async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
  ),
  PinoLoggerService: class FakeLogger {
    log() {}
    warn() {}
    error() {}
  },
  createCircuitBreakerMetrics: () => ({
    recordDecision() {},
    recordTransition() {},
    recordL1Hit() {},
    recordRedisError() {},
    recordDecideDuration() {},
  }),
}));

const {
  publishExecutionCompletedEvent,
  buildExecutionCompletedSubject,
  publishExecutionStartedEvent,
  buildExecutionStartedSubject,
  publishActionStartedEvent,
  publishActionCompletedEvent,
  buildActionStartedSubject,
  buildActionCompletedSubject,
  publishConditionEvaluatedEvent,
  buildConditionEvaluatedSubject,
} = await import(
  "../../src/temporal/activities/execution-completed-publisher.activity"
);

describe("publishExecutionCompletedEvent (async projection emit)", () => {
  beforeEach(() => {
    mockFlush.mockClear();
    mockPublish.mockClear();
    mockHeaderSet.mockClear();
    connectMock.mockClear();
    connectMock.mockImplementation(() => Promise.resolve(mockConn));
  });

  it("builds the canonical execution_completed subject for a tenant", () => {
    expect(buildExecutionCompletedSubject("tenant-a")).toBe(
      "evt.tenant-a.workflow-service.workflow.internal.native.execution_completed.v1"
    );
  });

  it("publishes a canonical envelope to INGRESS-<tenant> on COMPLETED", async () => {
    await publishExecutionCompletedEvent({
      executionId: "exec-1",
      status: "COMPLETED",
      tenantId: "tenant-a",
      workflowName: "wf-1",
    });

    expect(mockPublish).toHaveBeenCalledTimes(1);
    const [subject, payloadBytes] = mockPublish.mock.calls[0];
    expect(subject).toBe(
      "evt.tenant-a.workflow-service.workflow.internal.native.execution_completed.v1"
    );

    const envelope = JSON.parse(
      new TextDecoder().decode(payloadBytes as Uint8Array)
    );
    expect(envelope.specversion).toBe("1.0");
    expect(envelope.tenant).toBe("tenant-a");
    expect(envelope.type).toBe("io.yoizen.workflow.execution.completed.v1");
    expect(envelope.producer).toBe("workflow-service");
    expect(envelope.data.payload.executionId).toBe("exec-1");
    expect(envelope.data.payload.status).toBe("COMPLETED");
    expect(envelope.data.payload.workflowName).toBe("wf-1");
    expect(envelope.idempotencykey).toMatch(/^sha256:/);
    expect(envelope.resource).toBe("tenant/tenant-a/workflow-execution/exec-1");

    expect(mockFlush).toHaveBeenCalledTimes(1);

    const headerCalls = mockHeaderSet.mock.calls;
    const natsMsgId = headerCalls.find(([k]) => k === "Nats-Msg-Id");
    expect(natsMsgId).toBeDefined();
    expect(natsMsgId?.[1]).toBe(envelope.idempotencykey);
  });

  it("produces deterministic Nats-Msg-Id for same (executionId, status)", async () => {
    await publishExecutionCompletedEvent({
      executionId: "exec-X",
      status: "COMPLETED",
      tenantId: "t",
    });
    const first = JSON.parse(
      new TextDecoder().decode(mockPublish.mock.calls[0][1] as Uint8Array)
    ).idempotencykey;
    mockPublish.mockClear();

    await publishExecutionCompletedEvent({
      executionId: "exec-X",
      status: "COMPLETED",
      tenantId: "t",
    });
    const second = JSON.parse(
      new TextDecoder().decode(mockPublish.mock.calls[0][1] as Uint8Array)
    ).idempotencykey;

    expect(first).toBe(second);
  });

  it("uses a different idempotencykey for FAILED vs COMPLETED", async () => {
    await publishExecutionCompletedEvent({
      executionId: "exec-Y",
      status: "COMPLETED",
      tenantId: "t",
    });
    const completed = JSON.parse(
      new TextDecoder().decode(mockPublish.mock.calls[0][1] as Uint8Array)
    ).idempotencykey;
    mockPublish.mockClear();

    await publishExecutionCompletedEvent({
      executionId: "exec-Y",
      status: "FAILED",
      tenantId: "t",
    });
    const failed = JSON.parse(
      new TextDecoder().decode(mockPublish.mock.calls[0][1] as Uint8Array)
    ).idempotencykey;

    expect(completed).not.toBe(failed);
  });

  it("accepts the legacy positional signature (executionId, status, tenantId, workflowName)", async () => {
    await publishExecutionCompletedEvent(
      "exec-legacy",
      "COMPLETED",
      "tenant-a",
      "wf"
    );
    expect(mockPublish).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(
      new TextDecoder().decode(mockPublish.mock.calls[0][1] as Uint8Array)
    );
    expect(envelope.data.payload.executionId).toBe("exec-legacy");
    expect(envelope.data.payload.status).toBe("COMPLETED");
    expect(envelope.data.payload.workflowName).toBe("wf");
  });

  /**
   * Correlation-chain fix (DOCS/messaging/envelope.md §6): when the
   * caller forwards the workflow's causal context, the envelope must
   * inherit correlation_id unchanged, point causation_id at the
   * triggering event, and carry the forwarded depth.
   */
  it("inherits causal context (correlation, causation, depth) when provided", async () => {
    await publishExecutionCompletedEvent({
      executionId: "exec-causal",
      status: "COMPLETED",
      tenantId: "tenant-a",
      workflowName: "wf-1",
      correlationId: "corr-root-1",
      causationId: "recv-evt-1",
      depth: 2,
    });

    expect(mockPublish).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(
      new TextDecoder().decode(mockPublish.mock.calls[0][1] as Uint8Array)
    );
    expect(envelope.correlation_id).toBe("corr-root-1");
    expect(envelope.causation_id).toBe("recv-evt-1");
    expect(envelope.transport.depth).toBe(2);

    const headerCalls = mockHeaderSet.mock.calls;
    const corrHeader = headerCalls.find(([k]) => k === "X-Correlation-Id");
    const causHeader = headerCalls.find(([k]) => k === "X-Causation-Id");
    expect(corrHeader?.[1]).toBe("corr-root-1");
    expect(causHeader?.[1]).toBe("recv-evt-1");
  });

  it("stays a self-correlated root (causation null, depth 0) when no causal context is provided", async () => {
    await publishExecutionCompletedEvent({
      executionId: "exec-root",
      status: "COMPLETED",
      tenantId: "tenant-a",
    });

    const envelope = JSON.parse(
      new TextDecoder().decode(mockPublish.mock.calls[0][1] as Uint8Array)
    );
    expect(envelope.correlation_id).toBe(envelope.id);
    expect(envelope.causation_id).toBeNull();
    expect(envelope.transport.depth).toBe(0);

    const causHeader = mockHeaderSet.mock.calls.find(
      ([k]) => k === "X-Causation-Id"
    );
    expect(causHeader).toBeUndefined();
  });

  it("no-ops silently when tenantId is missing", async () => {
    await publishExecutionCompletedEvent("exec-no-tenant", "COMPLETED");
    expect(mockPublish).toHaveBeenCalledTimes(0);
    expect(connectMock).toHaveBeenCalledTimes(0);
  });
});

/**
 * T02 — execution_started emitter (manual-loops/workflow-step-events.md).
 * MIRRORS the `publishExecutionCompletedEvent` suite above: same
 * publish path (`getConnection()`/`conn.publish()`), same envelope
 * derivation, same subject-builder pattern
 * (`buildExecutionStartedSubject`). Also asserts envelope compliance
 * (`isCompliantEnvelope`) and shape-parity with the T01 fixture
 * (`fixtures/bus-events/workflow-service-execution-started-envelope-01.json`).
 */
describe("publishExecutionStartedEvent (execution_started emit)", () => {
  beforeEach(() => {
    mockFlush.mockClear();
    mockPublish.mockClear();
    mockHeaderSet.mockClear();
    connectMock.mockClear();
    connectMock.mockImplementation(() => Promise.resolve(mockConn));
  });

  it("builds the canonical execution_started subject for a tenant", () => {
    expect(buildExecutionStartedSubject("tenant-a")).toBe(
      "evt.tenant-a.workflow-service.workflow.internal.native.execution_started.v1"
    );
  });

  it("matches the T01 fixture's subject convention and CloudEvents type", () => {
    expect(executionStartedFixture.type).toBe(
      "io.yoizen.workflow.execution.started.v1"
    );
    expect(isCompliantEnvelope(executionStartedFixture)).toBe(true);
    expect(buildExecutionStartedSubject(executionStartedFixture.tenant)).toBe(
      "evt.tenant-a.workflow-service.workflow.internal.native.execution_started.v1"
    );
  });

  it("publishes a canonical, spec-compliant envelope to INGRESS-<tenant>", async () => {
    await publishExecutionStartedEvent({
      executionId: "exec-1",
      workflowId: "tenant-a:demo-workflow:abc123",
      runId: "run-1",
      tenantId: "tenant-a",
      workflowName: "demo-workflow",
    });

    expect(mockPublish).toHaveBeenCalledTimes(1);
    const [subject, payloadBytes] = mockPublish.mock.calls[0];
    expect(subject).toBe(
      "evt.tenant-a.workflow-service.workflow.internal.native.execution_started.v1"
    );

    const envelope = JSON.parse(
      new TextDecoder().decode(payloadBytes as Uint8Array)
    );

    expect(isCompliantEnvelope(envelope)).toBe(true);
    expect(envelope.specversion).toBe("1.0");
    expect(envelope.tenant).toBe("tenant-a");
    expect(envelope.type).toBe("io.yoizen.workflow.execution.started.v1");
    expect(envelope.producer).toBe("workflow-service");
    expect(envelope.domain).toBe("workflow");
    expect(envelope.channel).toBe("internal");
    expect(envelope.provider).toBe("native");
    expect(envelope.data.payload.executionId).toBe("exec-1");
    expect(envelope.data.payload.workflowId).toBe(
      "tenant-a:demo-workflow:abc123"
    );
    expect(envelope.data.payload.runId).toBe("run-1");
    expect(envelope.data.payload.workflowName).toBe("demo-workflow");
    expect(envelope.idempotencykey).toMatch(/^sha256:/);
    expect(envelope.resource).toBe("tenant/tenant-a/workflow-execution/exec-1");

    expect(mockFlush).toHaveBeenCalledTimes(1);

    const headerCalls = mockHeaderSet.mock.calls;
    const natsMsgId = headerCalls.find(([k]) => k === "Nats-Msg-Id");
    expect(natsMsgId).toBeDefined();
    expect(natsMsgId?.[1]).toBe(envelope.idempotencykey);
  });

  /**
   * Causal fields (SPEC decision 2 / T02 acceptance): correlation
   * preserved, causation = the trigger event id, depth incremented.
   */
  it("inherits causal context: correlation preserved, causation = trigger event, depth incremented", async () => {
    await publishExecutionStartedEvent({
      executionId: "exec-causal",
      workflowId: "tenant-a:demo-workflow:abc123",
      runId: "run-causal",
      tenantId: "tenant-a",
      workflowName: "demo-workflow",
      correlationId: "corr-root-1",
      causationId: "evt-trigger-1",
      depth: 2,
    });

    expect(mockPublish).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(
      new TextDecoder().decode(mockPublish.mock.calls[0][1] as Uint8Array)
    );
    expect(isCompliantEnvelope(envelope)).toBe(true);
    expect(envelope.correlation_id).toBe("corr-root-1");
    expect(envelope.causation_id).toBe("evt-trigger-1");
    expect(envelope.transport.depth).toBe(2);

    const headerCalls = mockHeaderSet.mock.calls;
    const corrHeader = headerCalls.find(([k]) => k === "X-Correlation-Id");
    const causHeader = headerCalls.find(([k]) => k === "X-Causation-Id");
    expect(corrHeader?.[1]).toBe("corr-root-1");
    expect(causHeader?.[1]).toBe("evt-trigger-1");
  });

  it("stays a self-correlated root (causation null, depth 0) when no causal context is provided", async () => {
    await publishExecutionStartedEvent({
      executionId: "exec-root",
      workflowId: "tenant-a:demo-workflow:abc123",
      runId: "run-root",
      tenantId: "tenant-a",
    });

    const envelope = JSON.parse(
      new TextDecoder().decode(mockPublish.mock.calls[0][1] as Uint8Array)
    );
    expect(isCompliantEnvelope(envelope)).toBe(true);
    expect(envelope.correlation_id).toBe(envelope.id);
    expect(envelope.causation_id).toBeNull();
    expect(envelope.transport.depth).toBe(0);

    const causHeader = mockHeaderSet.mock.calls.find(
      ([k]) => k === "X-Causation-Id"
    );
    expect(causHeader).toBeUndefined();
  });

  it("no-ops silently when tenantId is missing", async () => {
    await publishExecutionStartedEvent({
      executionId: "exec-no-tenant",
      workflowId: "tenant-a:demo-workflow:abc123",
      runId: "run-no-tenant",
      tenantId: "",
    });
    expect(mockPublish).toHaveBeenCalledTimes(0);
    expect(connectMock).toHaveBeenCalledTimes(0);
  });

  /**
   * `eventId` override (T03): lets the calling workflow generate the
   * id via Temporal's deterministic `uuid4()` BEFORE this activity
   * runs, so it can be cited as causation for action_started/completed.
   */
  it("uses the caller-supplied eventId instead of generating one", async () => {
    await publishExecutionStartedEvent({
      executionId: "exec-fixed-id",
      workflowId: "tenant-a:demo-workflow:abc123",
      runId: "run-fixed-id",
      tenantId: "tenant-a",
      eventId: "fixed-event-id-1",
    });
    const envelope = JSON.parse(
      new TextDecoder().decode(mockPublish.mock.calls[0][1] as Uint8Array)
    );
    expect(envelope.id).toBe("fixed-event-id-1");
  });
});

/**
 * T03 — action_started / action_completed emitters
 * (manual-loops/workflow-step-events.md). MIRRORS
 * `publishExecutionStartedEvent`'s suite: same publish path, same
 * envelope derivation, same subject-builder pattern.
 */
describe("publishActionStartedEvent / publishActionCompletedEvent (action telemetry emit)", () => {
  beforeEach(() => {
    mockFlush.mockClear();
    mockPublish.mockClear();
    mockHeaderSet.mockClear();
    connectMock.mockClear();
    connectMock.mockImplementation(() => Promise.resolve(mockConn));
  });

  it("builds the canonical action_started/action_completed subjects for a tenant", () => {
    expect(buildActionStartedSubject("tenant-a")).toBe(
      "evt.tenant-a.workflow-service.workflow.internal.native.action_started.v1"
    );
    expect(buildActionCompletedSubject("tenant-a")).toBe(
      "evt.tenant-a.workflow-service.workflow.internal.native.action_completed.v1"
    );
  });

  it("matches the T01 fixtures' subject convention and CloudEvents type", () => {
    expect(actionStartedFixture.type).toBe(
      "io.yoizen.workflow.action.started.v1"
    );
    expect(isCompliantEnvelope(actionStartedFixture)).toBe(true);
    expect(actionCompletedFixture.type).toBe(
      "io.yoizen.workflow.action.completed.v1"
    );
    expect(isCompliantEnvelope(actionCompletedFixture)).toBe(true);
  });

  /**
   * Causal contract (TAXONOMY.md rule 19 design note, corrected 2026-07-12):
   * action_started/action_completed are SIBLING hops off the run's
   * execution_started event, not chained step-to-step. Both fixtures MUST
   * cite the execution_started fixture's id as causation_id and share the
   * SAME constant depth (execution_started.depth + 1) — action_completed
   * does NOT chain off action_started's id.
   */
  it("matches the T01 fixtures' SIBLING causal contract (both cite execution_started, constant depth)", () => {
    expect(actionStartedFixture.causation_id).toBe(executionStartedFixture.id);
    expect(actionCompletedFixture.causation_id).toBe(
      executionStartedFixture.id
    );
    expect(actionStartedFixture.transport.depth).toBe(
      executionStartedFixture.transport.depth + 1
    );
    expect(actionCompletedFixture.transport.depth).toBe(
      actionStartedFixture.transport.depth
    );
  });

  it("publishes a spec-compliant action_started envelope with actionIndex/actionType/actionName", async () => {
    await publishActionStartedEvent({
      executionId: "exec-1",
      actionIndex: 0,
      actionType: "endpointCall",
      actionName: "fetch-customer",
      connectorId: "connector-1",
      tenantId: "tenant-a",
      correlationId: "corr-1",
      causationId: "wf-exec-started-1",
      depth: 2,
    });

    expect(mockPublish).toHaveBeenCalledTimes(1);
    const [subject, payloadBytes] = mockPublish.mock.calls[0];
    expect(subject).toBe(
      "evt.tenant-a.workflow-service.workflow.internal.native.action_started.v1"
    );
    const envelope = JSON.parse(
      new TextDecoder().decode(payloadBytes as Uint8Array)
    );
    expect(isCompliantEnvelope(envelope)).toBe(true);
    expect(envelope.type).toBe("io.yoizen.workflow.action.started.v1");
    expect(envelope.causation_id).toBe("wf-exec-started-1");
    expect(envelope.correlation_id).toBe("corr-1");
    expect(envelope.transport.depth).toBe(2);
    expect(envelope.data.payload).toEqual({
      executionId: "exec-1",
      actionIndex: 0,
      actionType: "endpointCall",
      actionName: "fetch-customer",
      connectorId: "connector-1",
    });
  });

  it("publishes action_completed with status:ok and no branch/connector/agent when absent", async () => {
    await publishActionCompletedEvent({
      executionId: "exec-1",
      actionIndex: 1,
      actionType: "jsFunction",
      actionName: "compute",
      status: "ok",
      tenantId: "tenant-a",
    });
    const envelope = JSON.parse(
      new TextDecoder().decode(mockPublish.mock.calls[0][1] as Uint8Array)
    );
    expect(envelope.type).toBe("io.yoizen.workflow.action.completed.v1");
    expect(envelope.data.payload).toEqual({
      executionId: "exec-1",
      actionIndex: 1,
      actionType: "jsFunction",
      actionName: "compute",
      status: "ok",
    });
  });

  it("publishes action_completed with status:failed and errorClass, and includes branch label", async () => {
    await publishActionCompletedEvent({
      executionId: "exec-1",
      actionIndex: 2,
      actionType: "jsFunction",
      actionName: "risky",
      branch: "pathA",
      status: "failed",
      errorClass: "TypeError",
      tenantId: "tenant-a",
    });
    const envelope = JSON.parse(
      new TextDecoder().decode(mockPublish.mock.calls[0][1] as Uint8Array)
    );
    expect(envelope.data.payload).toEqual({
      executionId: "exec-1",
      actionIndex: 2,
      actionType: "jsFunction",
      actionName: "risky",
      branch: "pathA",
      status: "failed",
      errorClass: "TypeError",
    });
    // No stack trace in the payload (SPEC constraint).
    expect(JSON.stringify(envelope.data.payload)).not.toContain("at ");
  });

  it("attaches agentId for agent-targeting actions", async () => {
    await publishActionStartedEvent({
      executionId: "exec-1",
      actionIndex: 0,
      actionType: "agentCall",
      actionName: "yc",
      agentId: "agent-1",
      tenantId: "tenant-a",
    });
    const envelope = JSON.parse(
      new TextDecoder().decode(mockPublish.mock.calls[0][1] as Uint8Array)
    );
    expect(envelope.data.payload.agentId).toBe("agent-1");
  });

  it("no-ops silently when tenantId is missing", async () => {
    await publishActionStartedEvent({
      executionId: "exec-no-tenant",
      actionIndex: 0,
      actionType: "jsFunction",
      actionName: "x",
      tenantId: "",
    });
    await publishActionCompletedEvent({
      executionId: "exec-no-tenant",
      actionIndex: 0,
      actionType: "jsFunction",
      actionName: "x",
      status: "ok",
      tenantId: "",
    });
    expect(mockPublish).toHaveBeenCalledTimes(0);
    expect(connectMock).toHaveBeenCalledTimes(0);
  });
});

/**
 * T04 — condition_evaluated emitter (manual-loops/workflow-step-events.md).
 * MIRRORS the action-event suite above: same publish path, same
 * envelope derivation, same subject-builder pattern
 * (`buildConditionEvaluatedSubject`).
 */
describe("publishConditionEvaluatedEvent (condition_evaluated emit)", () => {
  beforeEach(() => {
    mockFlush.mockClear();
    mockPublish.mockClear();
    mockHeaderSet.mockClear();
    connectMock.mockClear();
    connectMock.mockImplementation(() => Promise.resolve(mockConn));
  });

  it("builds the canonical condition_evaluated subject for a tenant", () => {
    expect(buildConditionEvaluatedSubject("tenant-a")).toBe(
      "evt.tenant-a.workflow-service.workflow.internal.native.condition_evaluated.v1"
    );
  });

  it("matches the T01 fixture's subject convention and CloudEvents type", () => {
    expect(conditionEvaluatedFixture.type).toBe(
      "io.yoizen.workflow.condition.evaluated.v1"
    );
    expect(isCompliantEnvelope(conditionEvaluatedFixture)).toBe(true);
    expect(
      buildConditionEvaluatedSubject(conditionEvaluatedFixture.tenant)
    ).toBe(
      "evt.tenant-a.workflow-service.workflow.internal.native.condition_evaluated.v1"
    );
  });

  /**
   * Causal contract (TAXONOMY.md rule 19 design note, corrected 2026-07-12):
   * condition_evaluated is a SIBLING hop off the run's execution_started
   * event, NOT chained off the preceding action's action_completed. Depth
   * is the SAME constant depth as the sibling action_started/completed
   * events of the same run.
   */
  it("matches the T01 fixture's SIBLING causal contract (cites execution_started, constant depth)", () => {
    expect(conditionEvaluatedFixture.causation_id).toBe(
      executionStartedFixture.id
    );
    expect(conditionEvaluatedFixture.transport.depth).toBe(
      executionStartedFixture.transport.depth + 1
    );
    expect(conditionEvaluatedFixture.transport.depth).toBe(
      actionStartedFixture.transport.depth
    );
  });

  it("publishes a spec-compliant envelope with expression/evaluatedValue/branchTaken/cases", async () => {
    await publishConditionEvaluatedEvent({
      executionId: "exec-1",
      actionIndex: 1,
      expression: "{{results.fetch-customer.data.tier}}",
      evaluatedValue: "320",
      branchTaken: "100-500",
      cases: ["0-100", "100-500", "500+"],
      tenantId: "tenant-a",
      correlationId: "corr-1",
      // SIBLING hop: causation cites the run's execution_started event
      // id directly, not the preceding action's action_completed id.
      causationId: "wf-exec-started-1",
      depth: 3,
    });

    expect(mockPublish).toHaveBeenCalledTimes(1);
    const [subject, payloadBytes] = mockPublish.mock.calls[0];
    expect(subject).toBe(
      "evt.tenant-a.workflow-service.workflow.internal.native.condition_evaluated.v1"
    );

    const envelope = JSON.parse(
      new TextDecoder().decode(payloadBytes as Uint8Array)
    );
    expect(isCompliantEnvelope(envelope)).toBe(true);
    expect(envelope.type).toBe("io.yoizen.workflow.condition.evaluated.v1");
    expect(envelope.causation_id).toBe("wf-exec-started-1");
    expect(envelope.correlation_id).toBe("corr-1");
    expect(envelope.transport.depth).toBe(3);
    expect(envelope.data.payload).toEqual({
      executionId: "exec-1",
      actionIndex: 1,
      expression: "{{results.fetch-customer.data.tier}}",
      evaluatedValue: "320",
      branchTaken: "100-500",
      cases: ["0-100", "100-500", "500+"],
    });
  });

  it("sets branchTaken null for an if-without-else evaluating false", async () => {
    await publishConditionEvaluatedEvent({
      executionId: "exec-1",
      actionIndex: 0,
      expression: "{{results.check.status}}",
      evaluatedValue: "pendiente",
      branchTaken: null,
      cases: ["approved"],
      tenantId: "tenant-a",
    });
    const envelope = JSON.parse(
      new TextDecoder().decode(mockPublish.mock.calls[0][1] as Uint8Array)
    );
    expect(envelope.data.payload.branchTaken).toBeNull();
  });

  it("includes truncated: true only when the caller sets it", async () => {
    await publishConditionEvaluatedEvent({
      executionId: "exec-1",
      actionIndex: 0,
      expression: "{{results.check.status}}",
      evaluatedValue: "x".repeat(256),
      branchTaken: "matches",
      cases: ["matches"],
      truncated: true,
      tenantId: "tenant-a",
    });
    const envelope = JSON.parse(
      new TextDecoder().decode(mockPublish.mock.calls[0][1] as Uint8Array)
    );
    expect(envelope.data.payload.truncated).toBe(true);
    mockPublish.mockClear();

    await publishConditionEvaluatedEvent({
      executionId: "exec-1",
      actionIndex: 0,
      expression: "{{results.check.status}}",
      evaluatedValue: "short",
      branchTaken: "matches",
      cases: ["matches"],
      tenantId: "tenant-a",
    });
    const envelope2 = JSON.parse(
      new TextDecoder().decode(mockPublish.mock.calls[0][1] as Uint8Array)
    );
    expect(envelope2.data.payload.truncated).toBeUndefined();
  });

  it("no-ops silently when tenantId is missing", async () => {
    await publishConditionEvaluatedEvent({
      executionId: "exec-no-tenant",
      actionIndex: 0,
      expression: "{{results.check.status}}",
      evaluatedValue: "x",
      branchTaken: null,
      cases: [],
      tenantId: "",
    });
    expect(mockPublish).toHaveBeenCalledTimes(0);
    expect(connectMock).toHaveBeenCalledTimes(0);
  });
});
