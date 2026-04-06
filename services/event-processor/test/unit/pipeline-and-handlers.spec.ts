import { describe, it, expect, mock } from "bun:test";
import { EnrichmentStage } from "../../src/pipeline/enrichment.stage";
import { TransformStage } from "../../src/pipeline/transform.stage";
import { ValidationStage } from "../../src/pipeline/validation.stage";
import { PipelineRunner } from "../../src/pipeline/pipeline-runner";
import { DefaultHandler } from "../../src/handlers/default.handler";
import {
  CreatedHandler,
  DeletedHandler,
  UpdatedHandler,
} from "../../src/handlers/lifecycle-handlers";

function envelope(type = "created") {
  return {
    id: "evt-1",
    type,
    source: "events.created",
    correlation_id: "",
    data: {
      received_at: "",
      payload: { value: 1 },
    },
  } as unknown as import("@yoizen/shared").EventEnvelope;
}

describe("Event processor missing coverage", () => {
  it("enrichment stage sets correlation and source", async () => {
    const stage = new EnrichmentStage();
    const result = await stage.process(envelope(), {
      tenantId: "tenant-a",
      subject: "events.created",
      correlationId: "corr-1",
    });

    expect(result.correlation_id).toBe("corr-1");
    expect(result.source).toBe("events.created");
  });

  it("transform stage applies registered transformers in order", async () => {
    const stage = new TransformStage();
    stage.registerTransformer((payload) => ({ ...payload, a: 1 }));
    stage.registerTransformer((payload) => ({ ...payload, b: 2 }));

    const result = await stage.process(envelope(), {
      tenantId: "tenant-a",
      subject: "events.created",
      correlationId: "corr-1",
    });

    expect(result.data.payload).toEqual({ value: 1, a: 1, b: 2 });
  });

  it("validation stage throws on invalid payload", async () => {
    const stage = new ValidationStage();
    stage.registerSchema("created", {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
    });

    await expect(
      stage.process(envelope("created"), {
        tenantId: "tenant-a",
        subject: "events.created",
        correlationId: "corr-1",
      }),
    ).rejects.toThrow();
  });

  it("pipeline runner executes stages in ascending order", async () => {
    const calls: number[] = [];
    const makeStage = (order: number) => ({
      order,
      process: mock(async (event: import("@yoizen/shared").EventEnvelope) => {
        calls.push(order);
        return event;
      }),
    });
    const runner = new PipelineRunner(
      makeStage(30) as unknown as import("../../src/pipeline/validation.stage").ValidationStage,
      makeStage(20) as unknown as import("../../src/pipeline/enrichment.stage").EnrichmentStage,
      makeStage(25) as unknown as import("../../src/pipeline/adapter-enrichment.stage").AdapterEnrichmentStage,
      makeStage(40) as unknown as import("../../src/pipeline/transform.stage").TransformStage,
      makeStage(10) as unknown as import("../../src/pipeline/adapter-forward.stage").AdapterForwardStage
    );

    await runner.run(envelope(), {
      tenantId: "tenant-a",
      subject: "events.created",
      correlationId: "corr-1",
    });

    expect(calls).toEqual([10, 20, 25, 30, 40]);
  });

  it("handlers return expected processed values", async () => {
    const created = await new CreatedHandler().handle("id-1", {});
    const updated = await new UpdatedHandler().handle("id-2", {});
    const deleted = await new DeletedHandler().handle("id-3", {});
    const defaultEmpty = await new DefaultHandler().handle("id-4", {});
    const defaultFilled = await new DefaultHandler().handle("id-5", { ok: true });

    expect(created.processed).toBe(true);
    expect(updated.processed).toBe(true);
    expect(deleted.processed).toBe(true);
    expect(defaultEmpty.processed).toBe(false);
    expect(defaultFilled.processed).toBe(true);
  });
});
