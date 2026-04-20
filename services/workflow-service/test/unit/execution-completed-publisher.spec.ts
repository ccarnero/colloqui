import "reflect-metadata";
import { describe, it, expect, beforeEach, mock } from "bun:test";

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
      "evt.tenant-a.workflow-service.workflow.internal.native.execution_completed.v1",
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
      "evt.tenant-a.workflow-service.workflow.internal.native.execution_completed.v1",
    );

    const envelope = JSON.parse(
      new TextDecoder().decode(payloadBytes as Uint8Array),
    );
    expect(envelope.specversion).toBe("1.0");
    expect(envelope.tenant).toBe("tenant-a");
    expect(envelope.type).toBe("io.yoizen.workflow.execution.completed.v1");
    expect(envelope.producer).toBe("workflow-service");
    expect(envelope.data.payload.executionId).toBe("exec-1");
    expect(envelope.data.payload.status).toBe("COMPLETED");
    expect(envelope.data.payload.workflowName).toBe("wf-1");
    expect(envelope.idempotencykey).toMatch(/^sha256:/);
    expect(envelope.resource).toBe(
      "tenant/tenant-a/workflow-execution/exec-1",
    );

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
      new TextDecoder().decode(
        mockPublish.mock.calls[0][1] as Uint8Array,
      ),
    ).idempotencykey;
    mockPublish.mockClear();

    await publishExecutionCompletedEvent({
      executionId: "exec-X",
      status: "COMPLETED",
      tenantId: "t",
    });
    const second = JSON.parse(
      new TextDecoder().decode(
        mockPublish.mock.calls[0][1] as Uint8Array,
      ),
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
      new TextDecoder().decode(
        mockPublish.mock.calls[0][1] as Uint8Array,
      ),
    ).idempotencykey;
    mockPublish.mockClear();

    await publishExecutionCompletedEvent({
      executionId: "exec-Y",
      status: "FAILED",
      tenantId: "t",
    });
    const failed = JSON.parse(
      new TextDecoder().decode(
        mockPublish.mock.calls[0][1] as Uint8Array,
      ),
    ).idempotencykey;

    expect(completed).not.toBe(failed);
  });

  it("accepts the legacy positional signature (executionId, status, tenantId, workflowName)", async () => {
    await publishExecutionCompletedEvent(
      "exec-legacy",
      "COMPLETED",
      "tenant-a",
      "wf",
    );
    expect(mockPublish).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(
      new TextDecoder().decode(
        mockPublish.mock.calls[0][1] as Uint8Array,
      ),
    );
    expect(envelope.data.payload.executionId).toBe("exec-legacy");
    expect(envelope.data.payload.status).toBe("COMPLETED");
    expect(envelope.data.payload.workflowName).toBe("wf");
  });

  it("no-ops silently when tenantId is missing", async () => {
    await publishExecutionCompletedEvent("exec-no-tenant", "COMPLETED");
    expect(mockPublish).toHaveBeenCalledTimes(0);
    expect(connectMock).toHaveBeenCalledTimes(0);
  });
});
