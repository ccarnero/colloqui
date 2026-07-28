import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { JetStreamClient } from "nats";

// PinoLoggerService is a field initializer, not constructor-injected, so it
// must be mocked before the import resolves (same pattern as
// execution-handler-buffered.spec.ts).
mock.module("@yoizen/observability", () => ({
  PinoLoggerService: class MockLogger {
    debug = mock(() => {});
    error = mock(() => {});
    warn = mock(() => {});
    log = mock(() => {});
  },
}));

import type { EventEnvelope } from "@yoizen/shared";
import { MAX_DEPTH_BY_CATEGORY } from "@yoizen/shared";
import {
  type ILlmCallEventPayload,
  LlmCallEventPublisherService,
} from "../../src/modules/llm/llm-call-event-publisher.service";

function baseEvent(
  overrides: Partial<ILlmCallEventPayload> = {}
): ILlmCallEventPayload {
  return {
    tenantId: "acme",
    agentId: "agent-1",
    executionId: "exec-1",
    model: "gpt-4o-mini",
    provider: "openai",
    prompt: "hello there",
    completion: "hi!",
    inputTokens: 10,
    outputTokens: 5,
    cachedInputTokens: 0,
    costUsd: 0.0001,
    durationMs: 42,
    ...overrides,
  };
}

function fakeIncomingEnvelope(
  overrides: Partial<EventEnvelope> = {}
): EventEnvelope {
  return {
    specversion: "1.0",
    id: "incoming-id-1",
    source: "job-trigger-service",
    type: "io.yoizen.platform.runtime.job_triggered.v1",
    resource: "job/job-1",
    time: new Date().toISOString(),
    traceid: "trace-1",
    causation_id: null,
    correlation_id: "corr-1",
    tenant: "acme",
    producer: "job-trigger-service",
    domain: "automation",
    channel: "platform",
    provider: "internal",
    accountid: "acme",
    idempotencykey: "sha256:abc",
    transport: { method: "agent", protocol: "internal", depth: 0 },
    data: {
      received_at: new Date().toISOString(),
      payload_inline: true,
      payload_ref: null,
      payload_bytes: 2,
      payload_checksum: "sha256:abc",
      payload: {},
    },
    ...overrides,
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("LlmCallEventPublisherService", () => {
  let mockJs: { publish: ReturnType<typeof mock> };
  let publisher: LlmCallEventPublisherService;

  beforeEach(() => {
    mockJs = { publish: mock(() => Promise.resolve()) };
    publisher = new LlmCallEventPublisherService(
      mockJs as unknown as JetStreamClient
    );
  });

  it("publishes ai.llm_call.completed.v1 as a root event when no causal envelope is provided", async () => {
    publisher.publish(baseEvent());
    await flushMicrotasks();

    expect(mockJs.publish).toHaveBeenCalledTimes(1);
    const [subject, body] = mockJs.publish.mock.calls[0] as [string, string];
    expect(subject).toBe(
      "evt.acme.agent-ai-service.platform.llm.system.llm_call_completed.v1"
    );

    const envelope = JSON.parse(body);
    expect(envelope.type).toBe("ai.llm_call.completed.v1");
    expect(envelope.resource).toBe("execution/exec-1");
    expect(envelope.causation_id).toBeNull();
    expect(envelope.data.payload.model).toBe("gpt-4o-mini");
    expect(envelope.data.payload.provider).toBe("openai");
    expect(envelope.data.payload.inputTokens).toBe(10);
    expect(envelope.data.payload.outputTokens).toBe(5);
    expect(envelope.data.payload.costUsd).toBe(0.0001);
    expect(envelope.data.payload.durationMs).toBe(42);
  });

  it("threads the causal chain when the caller has an incoming envelope", async () => {
    const incoming = fakeIncomingEnvelope();
    publisher.publish(baseEvent({ causalEnvelope: incoming }));
    await flushMicrotasks();

    const [, body] = mockJs.publish.mock.calls[0] as [string, string];
    const envelope = JSON.parse(body);

    expect(envelope.causation_id).toBe(incoming.id);
    expect(envelope.correlation_id).toBe(incoming.correlation_id);
    expect(envelope.transport.depth).toBe(incoming.transport.depth + 1);
  });

  it("falls back to a root event (with a warn log) when causal depth would exceed MAX_DEPTH", async () => {
    const maxDepth = MAX_DEPTH_BY_CATEGORY.internal_service;
    const incomingAtCeiling = fakeIncomingEnvelope({
      transport: { method: "agent", protocol: "internal", depth: maxDepth },
    });

    publisher.publish(baseEvent({ causalEnvelope: incomingAtCeiling }));
    await flushMicrotasks();

    expect(mockJs.publish).toHaveBeenCalledTimes(1);
    const [, body] = mockJs.publish.mock.calls[0] as [string, string];
    const envelope = JSON.parse(body);

    // Root fallback: no causation/correlation inherited from the incoming
    // envelope — an orphan event beats a lost event (SPEC constraint).
    expect(envelope.causation_id).toBeNull();
    expect(envelope.correlation_id).not.toBe(incomingAtCeiling.correlation_id);
  });

  it("truncates prompt and completion to 8192 characters before publish", async () => {
    const longPrompt = "p".repeat(9000);
    const longCompletion = "c".repeat(9000);

    publisher.publish(
      baseEvent({ prompt: longPrompt, completion: longCompletion })
    );
    await flushMicrotasks();

    const [, body] = mockJs.publish.mock.calls[0] as [string, string];
    const envelope = JSON.parse(body);

    expect(envelope.data.payload.prompt.length).toBe(8192);
    expect(envelope.data.payload.completion.length).toBe(8192);
  });

  it("does not truncate prompt/completion under the 8192-char limit", async () => {
    publisher.publish(baseEvent({ prompt: "short", completion: "also short" }));
    await flushMicrotasks();

    const [, body] = mockJs.publish.mock.calls[0] as [string, string];
    const envelope = JSON.parse(body);

    expect(envelope.data.payload.prompt).toBe("short");
    expect(envelope.data.payload.completion).toBe("also short");
  });

  it("never throws synchronously when the underlying JetStream publish rejects", async () => {
    mockJs.publish = mock(() => Promise.reject(new Error("nats down")));

    expect(() => publisher.publish(baseEvent())).not.toThrow();
    await flushMicrotasks();

    // The internal logger is a mocked PinoLoggerService instance; assert via
    // the instance actually used by the publisher.
    const loggerInstance = (
      publisher as unknown as { logger: { warn: ReturnType<typeof mock> } }
    ).logger;
    expect(loggerInstance.warn).toHaveBeenCalled();
  });

  it("does not delay the caller: publish() returns before the async JetStream publish settles", () => {
    let resolvePublish: () => void = () => {};
    mockJs.publish = mock(
      () =>
        new Promise<void>((resolve) => {
          resolvePublish = resolve;
        })
    );

    const startedAt = Date.now();
    publisher.publish(baseEvent());
    const elapsedMs = Date.now() - startedAt;

    // publish() must return synchronously — it never awaits the underlying
    // JetStream call (fire-and-forget contract, SPEC constraint).
    expect(elapsedMs).toBeLessThan(5);
    resolvePublish();
  });
});
