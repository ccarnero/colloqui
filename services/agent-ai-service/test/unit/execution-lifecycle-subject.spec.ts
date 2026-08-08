import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { JetStreamClient, NatsConnection } from "nats";

// ── Module Mocks ──────────────────────────────────────────────────────────
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
import type { ChatService } from "../../src/modules/chat/chat.service";
import type { AgentTaskService } from "../../src/modules/job-executor/actions/agent-task.service";
import type { FunctionActionService } from "../../src/modules/job-executor/actions/function-action.service";
import type { LlmActionService } from "../../src/modules/job-executor/actions/llm-action.service";
import type { WebhookActionService } from "../../src/modules/job-executor/actions/webhook-action.service";
import { JobExecutorService } from "../../src/modules/job-executor/job-executor.service";
import { ExecutionHandler } from "../../src/nats-handlers/execution.handler";

/**
 * E3 wire contract (PENDIENTES/04-e3-subject.spec.md, 2026-08-07).
 *
 * Token 2 of an `evt.` subject is the producer routing key (AGENTS.md subject
 * grammar). Both `publishStatus` implementations used to hardcode
 * `ai-agent-gateway` there — the gateway only REQUESTS executions, this
 * service runs them — while stamping `producer: "agent-ai-service"` on the
 * envelope of the very same message. The `deriveEnvelope` branch lied in the
 * OPPOSITE direction: with no producer override it inherited
 * `ai-agent-gateway` from the incoming request envelope, so the body credited
 * the requester for an event this service produced.
 *
 * These assertions pin the full wire strings (not the shared constants they
 * are built from — that would be circular) and the subject/body agreement on
 * BOTH publish branches of BOTH publishers.
 */
const PREFIX = "evt.acme.agent-ai-service.automation.platform.internal";

function fakeIncomingEnvelope(
  overrides: Partial<EventEnvelope> = {}
): EventEnvelope {
  return {
    specversion: "1.0",
    id: "incoming-id-1",
    source: "ai-agent-gateway",
    type: "io.yoizen.platform.runtime.execution_requested.v1",
    resource: "execution/exec-1",
    time: new Date().toISOString(),
    traceid: "trace-1",
    causation_id: null,
    correlation_id: "corr-1",
    tenant: "acme",
    // The requester. `deriveEnvelope` inherits this field unless the call
    // site overrides it — which is exactly the bug this suite guards.
    producer: "ai-agent-gateway",
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

describe("ExecutionHandler.publishStatus — E3 subject/producer agreement", () => {
  let handler: ExecutionHandler;
  let mockChatService: { generateReply: ReturnType<typeof mock> };
  let mockJs: { publish: ReturnType<typeof mock> };
  let mockNc: {
    publish: ReturnType<typeof mock>;
    subscribe: ReturnType<typeof mock>;
  };

  function publishedOn(kind: string): [string, string] | undefined {
    return mockJs.publish.mock.calls.find((c) =>
      (c[0] as string).includes(kind)
    ) as [string, string] | undefined;
  }

  beforeEach(() => {
    mockChatService = {
      generateReply: mock(() =>
        Promise.resolve({
          text: "hi",
          usage: { totalTokens: 1 },
          costUsd: 0,
          toolCalls: [],
          toolResults: [],
          model: "m",
          provider: "p",
        })
      ),
    };
    mockJs = { publish: mock(() => Promise.resolve()) };
    mockNc = {
      publish: mock(() => {}),
      subscribe: mock((_subject: string, _opts: unknown) => ({
        unsubscribe: mock(() => {}),
      })),
    };

    handler = new ExecutionHandler(
      mockChatService as unknown as ChatService,
      mockJs as unknown as JetStreamClient,
      mockNc as unknown as NatsConnection
    );
    handler.onModuleInit();
  });

  it("publishes started/completed on the agent-ai-service subject family (buildEventEnvelope branch)", async () => {
    await handler.handle("acme", {
      input: { executionId: "exec-1", agentId: "agent-1", message: "hi" },
    });

    expect(publishedOn("execution_started")?.[0]).toBe(
      `${PREFIX}.execution_started.v1`
    );
    expect(publishedOn("execution_completed")?.[0]).toBe(
      `${PREFIX}.execution_completed.v1`
    );
  });

  it("stamps producer=agent-ai-service on the buildEventEnvelope branch", async () => {
    await handler.handle("acme", {
      input: { executionId: "exec-1", agentId: "agent-1", message: "hi" },
    });

    for (const kind of ["execution_started", "execution_completed"]) {
      const call = publishedOn(kind);
      expect(call).toBeDefined();
      const envelope = JSON.parse(call![1]);
      expect(envelope.producer).toBe("agent-ai-service");
      expect(call![0].split(".")[2]).toBe(envelope.producer);
    }
  });

  it("overrides the inherited requester producer on the deriveEnvelope branch", async () => {
    await handler.handle(
      "acme",
      { input: { executionId: "exec-1", agentId: "agent-1", message: "hi" } },
      fakeIncomingEnvelope()
    );

    for (const kind of ["execution_started", "execution_completed"]) {
      const call = publishedOn(kind);
      expect(call).toBeDefined();
      const envelope = JSON.parse(call![1]);
      // Causal chain still derived from the incoming request…
      expect(envelope.causation_id).toBe("incoming-id-1");
      expect(envelope.correlation_id).toBe("corr-1");
      // …but the producer is OURS, not the gateway's.
      expect(envelope.producer).toBe("agent-ai-service");
      expect(call![0].split(".")[2]).toBe(envelope.producer);
    }
  });

  it("publishes execution_failed on the agent-ai-service subject family", async () => {
    mockChatService.generateReply = mock(() =>
      Promise.reject(new Error("llm exploded"))
    );

    await handler.handle(
      "acme",
      { input: { executionId: "exec-1", agentId: "agent-1", message: "hi" } },
      fakeIncomingEnvelope()
    );

    const failed = publishedOn("execution_failed");
    expect(failed?.[0]).toBe(`${PREFIX}.execution_failed.v1`);
    expect(JSON.parse(failed![1]).producer).toBe("agent-ai-service");
  });
});

describe("JobExecutorService.publishStatus — E3 subject/producer agreement", () => {
  let service: JobExecutorService;
  let mockNc: { publish: ReturnType<typeof mock> };

  function publishedOn(kind: string): [string, string] | undefined {
    return mockNc.publish.mock.calls.find((c) =>
      (c[0] as string).includes(kind)
    ) as [string, string] | undefined;
  }

  beforeEach(() => {
    mockNc = { publish: mock(() => {}) };
    service = new JobExecutorService(
      {
        execute: mock(() => Promise.resolve({ text: "ok" })),
      } as unknown as LlmActionService,
      {} as unknown as WebhookActionService,
      {} as unknown as FunctionActionService,
      {} as unknown as AgentTaskService,
      mockNc as unknown as NatsConnection
    );
  });

  it("publishes started/completed on the agent-ai-service subject family (buildEventEnvelope branch)", async () => {
    await service.executeJob("acme", {
      jobId: "job-1",
      executionId: "exec-1",
      eventPayload: { action_type: "llm_call" },
    });

    expect(publishedOn("execution_started")?.[0]).toBe(
      `${PREFIX}.execution_started.v1`
    );
    expect(publishedOn("execution_completed")?.[0]).toBe(
      `${PREFIX}.execution_completed.v1`
    );
    for (const kind of ["execution_started", "execution_completed"]) {
      const call = publishedOn(kind)!;
      const envelope = JSON.parse(call[1]);
      expect(envelope.producer).toBe("agent-ai-service");
      expect(call[0].split(".")[2]).toBe(envelope.producer);
    }
  });

  it("overrides the inherited requester producer on the deriveEnvelope branch", async () => {
    await service.executeJob(
      "acme",
      {
        jobId: "job-1",
        executionId: "exec-1",
        eventPayload: { action_type: "llm_call" },
      },
      fakeIncomingEnvelope()
    );

    for (const kind of ["execution_started", "execution_completed"]) {
      const call = publishedOn(kind)!;
      const envelope = JSON.parse(call[1]);
      expect(envelope.causation_id).toBe("incoming-id-1");
      expect(envelope.producer).toBe("agent-ai-service");
      expect(call[0].split(".")[2]).toBe(envelope.producer);
    }
  });

  it("publishes execution_failed on the agent-ai-service subject family", async () => {
    await service.executeJob("acme", {
      jobId: "job-1",
      executionId: "exec-1",
      eventPayload: { action_type: "totally-unknown" },
    });

    const failed = publishedOn("execution_failed");
    expect(failed?.[0]).toBe(`${PREFIX}.execution_failed.v1`);
    expect(JSON.parse(failed![1]).producer).toBe("agent-ai-service");
  });
});
