import "reflect-metadata";
import { beforeEach, describe, expect, it, mock } from "bun:test";

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

const { publishExecutionCompletedEvent, buildExecutionCompletedSubject } =
  await import(
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
