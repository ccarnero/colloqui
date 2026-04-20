import "reflect-metadata";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { JsMsg } from "nats";
import { ExecutionProjectorService } from "../../src/modules/executions-projector/execution-projector.service";
import type { ExecutionsProjectionRepository } from "../../src/modules/executions-projector/executions.repository";

/**
 * Builds a minimal fake JsMsg carrying a canonical
 * workflow.execution.completed envelope. We bypass the
 * MultiTenantConsumerManager entirely and exercise the private
 * `enqueue` handler directly via the public contract — i.e.,
 * invoke it the same way the manager would.
 */
function makeMsg(
  executionId: string,
  status: string,
  subject = "evt.t1.workflow-service.workflow.internal.native.execution_completed.v1",
): JsMsg {
  const envelope = {
    specversion: "1.0",
    id: `evt-${executionId}`,
    type: "io.yoizen.workflow.execution.completed.v1",
    tenant: "t1",
    data: { payload: { executionId, status } },
  };
  const data = new TextEncoder().encode(JSON.stringify(envelope));
  return { subject, data } as unknown as JsMsg;
}

describe("ExecutionProjectorService", () => {
  let applyStatusBatch: ReturnType<typeof mock>;
  let repo: ExecutionsProjectionRepository;
  let svc: ExecutionProjectorService;

  beforeEach(() => {
    applyStatusBatch = mock((rows: { id: string; status: string }[]) =>
      Promise.resolve(rows.length),
    );
    repo = {
      applyStatusBatch,
    } as unknown as ExecutionsProjectionRepository;
    svc = new ExecutionProjectorService(
      {} as never,
      {} as never,
      repo,
    );
  });

  it("flushes a batch after MAX_BATCH_WAIT_MS", async () => {
    const p1 = (svc as unknown as {
      enqueue: (m: JsMsg) => Promise<void>;
    }).enqueue(makeMsg("e1", "COMPLETED"));
    const p2 = (svc as unknown as {
      enqueue: (m: JsMsg) => Promise<void>;
    }).enqueue(makeMsg("e2", "FAILED"));

    await Promise.all([p1, p2]);

    expect(applyStatusBatch).toHaveBeenCalledTimes(1);
    const [batch] = applyStatusBatch.mock.calls[0];
    expect(batch).toEqual([
      { id: "e1", status: "COMPLETED" },
      { id: "e2", status: "FAILED" },
    ]);
  });

  it("flushes immediately once the batch reaches MAX_BATCH_SIZE (100)", async () => {
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 100; i++) {
      promises.push(
        (svc as unknown as {
          enqueue: (m: JsMsg) => Promise<void>;
        }).enqueue(makeMsg(`e${i}`, "COMPLETED")),
      );
    }
    await Promise.all(promises);

    expect(applyStatusBatch).toHaveBeenCalledTimes(1);
    const [batch] = applyStatusBatch.mock.calls[0];
    expect(batch.length).toBe(100);
  });

  it("splits 150 messages into two batches (100 + 50)", async () => {
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 150; i++) {
      promises.push(
        (svc as unknown as {
          enqueue: (m: JsMsg) => Promise<void>;
        }).enqueue(makeMsg(`e${i}`, "COMPLETED")),
      );
    }
    await Promise.all(promises);

    expect(applyStatusBatch).toHaveBeenCalledTimes(2);
    const first = applyStatusBatch.mock.calls[0][0];
    const second = applyStatusBatch.mock.calls[1][0];
    expect(first.length).toBe(100);
    expect(second.length).toBe(50);
  });

  it("rejects every pending promise in the batch when the repo throws", async () => {
    applyStatusBatch.mockImplementationOnce(() =>
      Promise.reject(new Error("pg down")),
    );

    const p1 = (svc as unknown as {
      enqueue: (m: JsMsg) => Promise<void>;
    }).enqueue(makeMsg("e1", "COMPLETED"));
    const p2 = (svc as unknown as {
      enqueue: (m: JsMsg) => Promise<void>;
    }).enqueue(makeMsg("e2", "FAILED"));

    // Attach error handlers immediately so neither promise becomes
    // an unhandled rejection when the shared batch fails.
    const results = await Promise.allSettled([p1, p2]);
    expect(results[0]!.status).toBe("rejected");
    expect(results[1]!.status).toBe("rejected");
    expect((results[0] as PromiseRejectedResult).reason.message).toBe(
      "pg down",
    );
    expect((results[1] as PromiseRejectedResult).reason.message).toBe(
      "pg down",
    );
  });

  it("resolves without touching the repo when message is unparseable", async () => {
    const bad = {
      subject: "evt.t1.workflow-service.workflow.internal.native.execution_completed.v1",
      data: new TextEncoder().encode("not-json"),
    } as unknown as JsMsg;

    await (svc as unknown as {
      enqueue: (m: JsMsg) => Promise<void>;
    }).enqueue(bad);

    expect(applyStatusBatch).toHaveBeenCalledTimes(0);
  });

  it("resolves without touching the repo when payload lacks executionId/status", async () => {
    const subject =
      "evt.t1.workflow-service.workflow.internal.native.execution_completed.v1";
    const envelope = {
      specversion: "1.0",
      id: "evt-x",
      tenant: "t1",
      data: { payload: { nope: true } },
    };
    const msg = {
      subject,
      data: new TextEncoder().encode(JSON.stringify(envelope)),
    } as unknown as JsMsg;

    await (svc as unknown as {
      enqueue: (m: JsMsg) => Promise<void>;
    }).enqueue(msg);

    expect(applyStatusBatch).toHaveBeenCalledTimes(0);
  });
});
