import "reflect-metadata";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { ConflictException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { NATS_CONNECTION } from "@yoizen/database";
import type { WorkflowTrigger } from "@yoizen/shared";
import { WorkflowStatus } from "@yoizen/shared";
import { TriggerConsumerService } from "../../src/modules/triggers/trigger-consumer.service";
import {
  type IWorkflowDefinitionRow,
  WORKFLOWS_REPOSITORY,
} from "../../src/modules/workflows/workflows.repository.interface";
import { WorkflowsService } from "../../src/modules/workflows/workflows.service";
import {
  JETSTREAM_MANAGER,
  JETSTREAM_PUBLISHER,
} from "../../src/providers/providers.module";

function makeDefinition(
  overrides: Partial<IWorkflowDefinitionRow> & {
    trigger: WorkflowTrigger;
  }
): IWorkflowDefinitionRow {
  return {
    id: overrides.id ?? "def-1",
    name: overrides.name ?? "wf",
    application: overrides.application ?? "app",
    actions: [],
    trigger: overrides.trigger,
    status: overrides.status ?? WorkflowStatus.ENABLED,
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
  };
}

const sharedTrigger: WorkflowTrigger = {
  type: "message_received",
  mode: "shared",
  config: { channels: ["telegram"], providers: ["telegram"] },
};

const exclusiveTrigger: WorkflowTrigger = {
  type: "message_received",
  mode: "exclusive",
  config: {},
};

/**
 * Subscribes to a channel the fixture envelope is NOT on — the negative case
 * for the channel filter. (It used to be `telegram` against a `whatsapp`
 * envelope; with the Meta family decommissioned the envelope is `telegram`,
 * so the non-matching channel is `http`.)
 */
const otherChannelTrigger: WorkflowTrigger = {
  type: "message_received",
  mode: "shared",
  config: { channels: ["http"] },
};

const patternTrigger: WorkflowTrigger = {
  type: "message_received",
  mode: "shared",
  config: { patterns: ["^hello"] },
};

const accountTriggerMatch: WorkflowTrigger = {
  type: "message_received",
  mode: "shared",
  config: { accountIds: ["acc-1"] },
};

const accountTriggerMiss: WorkflowTrigger = {
  type: "message_received",
  mode: "shared",
  config: { accountIds: ["acc-2", "acc-3"] },
};

describe("TriggerConsumerService", () => {
  let service: TriggerConsumerService;
  const findByTriggerType = mock(() =>
    Promise.resolve([] as IWorkflowDefinitionRow[])
  );
  const executeWorkflow = mock(() =>
    Promise.resolve({
      executionId: "exe-1",
      definitionId: "def-1",
      temporalWorkflowId: "tw-1",
      runId: "run-1",
    })
  );

  const ncMock = {
    subscribe: mock(() => ({ unsubscribe: mock() })),
    isClosed: () => false,
  };

  beforeEach(async () => {
    findByTriggerType.mockClear();
    executeWorkflow.mockClear();

    const moduleRef = await Test.createTestingModule({
      providers: [
        TriggerConsumerService,
        { provide: NATS_CONNECTION, useValue: ncMock },
        { provide: JETSTREAM_MANAGER, useValue: {} },
        { provide: JETSTREAM_PUBLISHER, useValue: {} },
        {
          provide: WorkflowsService,
          useValue: { executeWorkflow },
        },
        {
          provide: WORKFLOWS_REPOSITORY,
          useValue: { findDefinitionsByTriggerType: findByTriggerType },
        },
      ],
    }).compile();

    service = moduleRef.get(TriggerConsumerService);
  });

  function buildMessage(
    subject: string,
    data: Record<string, unknown>
  ): { subject: string; data: Uint8Array } {
    return {
      subject,
      data: new TextEncoder().encode(JSON.stringify(data)),
    };
  }

  const baseEnvelope = {
    id: "msg-1",
    tenantId: "t1",
    channel: "telegram",
    provider: "telegram",
    kind: "received",
    correlation_id: "conv-abc",
    transport: { method: "webhook", protocol: "https", depth: 0 },
    data: { from: "+1234", text: "hello world", accountId: "acc-1" },
  };

  it("does nothing when no definitions have triggers", async () => {
    findByTriggerType.mockResolvedValue([]);

    await (
      service as unknown as { handleMessage: (m: unknown) => Promise<void> }
    ).handleMessage(
      buildMessage(
        "evt.t1.channel-service.messaging.telegram.telegram.received.v1",
        baseEnvelope
      )
    );

    expect(executeWorkflow).not.toHaveBeenCalled();
  });

  it("triggers shared workflows that match channel and provider", async () => {
    findByTriggerType.mockResolvedValue([
      makeDefinition({ id: "def-1", trigger: sharedTrigger }),
      makeDefinition({ id: "def-2", trigger: sharedTrigger }),
    ]);

    await (
      service as unknown as { handleMessage: (m: unknown) => Promise<void> }
    ).handleMessage(
      buildMessage(
        "evt.t1.channel-service.messaging.telegram.telegram.received.v1",
        baseEnvelope
      )
    );

    expect(executeWorkflow).toHaveBeenCalledTimes(2);
  });

  it("filters out workflows that do not match channel", async () => {
    findByTriggerType.mockResolvedValue([
      makeDefinition({ id: "def-1", trigger: otherChannelTrigger }),
    ]);

    await (
      service as unknown as { handleMessage: (m: unknown) => Promise<void> }
    ).handleMessage(
      buildMessage(
        "evt.t1.channel-service.messaging.telegram.telegram.received.v1",
        baseEnvelope
      )
    );

    expect(executeWorkflow).not.toHaveBeenCalled();
  });

  it("only fires one exclusive workflow when present", async () => {
    findByTriggerType.mockResolvedValue([
      makeDefinition({ id: "excl-1", trigger: exclusiveTrigger }),
      makeDefinition({ id: "shared-1", trigger: sharedTrigger }),
    ]);

    await (
      service as unknown as { handleMessage: (m: unknown) => Promise<void> }
    ).handleMessage(
      buildMessage(
        "evt.t1.channel-service.messaging.telegram.telegram.received.v1",
        baseEnvelope
      )
    );

    expect(executeWorkflow).toHaveBeenCalledTimes(1);
  });

  it("matches text patterns when configured", async () => {
    findByTriggerType.mockResolvedValue([
      makeDefinition({ id: "pat-1", trigger: patternTrigger }),
    ]);

    await (
      service as unknown as { handleMessage: (m: unknown) => Promise<void> }
    ).handleMessage(
      buildMessage(
        "evt.t1.channel-service.messaging.telegram.telegram.received.v1",
        baseEnvelope
      )
    );

    expect(executeWorkflow).toHaveBeenCalledTimes(1);
  });

  it("skips when text pattern does not match", async () => {
    findByTriggerType.mockResolvedValue([
      makeDefinition({ id: "pat-1", trigger: patternTrigger }),
    ]);

    const noMatchEnvelope = {
      ...baseEnvelope,
      data: { ...baseEnvelope.data, text: "goodbye" },
    };

    await (
      service as unknown as { handleMessage: (m: unknown) => Promise<void> }
    ).handleMessage(
      buildMessage(
        "evt.t1.channel-service.messaging.telegram.telegram.received.v1",
        noMatchEnvelope
      )
    );

    expect(executeWorkflow).not.toHaveBeenCalled();
  });

  it("triggers workflow when accountIds matches the envelope accountId", async () => {
    findByTriggerType.mockResolvedValue([
      makeDefinition({ id: "acc-match", trigger: accountTriggerMatch }),
    ]);

    await (
      service as unknown as { handleMessage: (m: unknown) => Promise<void> }
    ).handleMessage(
      buildMessage(
        "evt.t1.channel-service.messaging.telegram.telegram.received.v1",
        baseEnvelope
      )
    );

    expect(executeWorkflow).toHaveBeenCalledTimes(1);
  });

  it("skips workflow when accountIds does not include the envelope accountId", async () => {
    findByTriggerType.mockResolvedValue([
      makeDefinition({ id: "acc-miss", trigger: accountTriggerMiss }),
    ]);

    await (
      service as unknown as { handleMessage: (m: unknown) => Promise<void> }
    ).handleMessage(
      buildMessage(
        "evt.t1.channel-service.messaging.telegram.telegram.received.v1",
        baseEnvelope
      )
    );

    expect(executeWorkflow).not.toHaveBeenCalled();
  });

  it("forwards causal chain (id, correlation_id, transport.depth) to executeWorkflow", async () => {
    findByTriggerType.mockResolvedValue([
      makeDefinition({ id: "def-1", trigger: sharedTrigger }),
    ]);

    await (
      service as unknown as { handleMessage: (m: unknown) => Promise<void> }
    ).handleMessage(
      buildMessage(
        "evt.t1.channel-service.messaging.telegram.telegram.received.v1",
        baseEnvelope
      )
    );

    expect(executeWorkflow).toHaveBeenCalledTimes(1);
    const [, , , options] = executeWorkflow.mock.calls[0];
    expect(options?.causal).toEqual({
      causation_id: "msg-1",
      correlation_id: "conv-abc",
      depth: 0,
    });
  });

  it("inherits depth from transport.depth when set (multi-hop chain)", async () => {
    findByTriggerType.mockResolvedValue([
      makeDefinition({ id: "def-1", trigger: sharedTrigger }),
    ]);
    const deepEnvelope = {
      ...baseEnvelope,
      transport: { method: "stream", protocol: "internal", depth: 2 },
    };

    await (
      service as unknown as { handleMessage: (m: unknown) => Promise<void> }
    ).handleMessage(
      buildMessage(
        "evt.t1.channel-service.messaging.telegram.telegram.received.v1",
        deepEnvelope
      )
    );

    const [, , , options] = executeWorkflow.mock.calls[0];
    expect(options?.causal?.depth).toBe(2);
  });

  it("omits causal when envelope lacks id/correlation_id (legacy events)", async () => {
    findByTriggerType.mockResolvedValue([
      makeDefinition({ id: "def-1", trigger: sharedTrigger }),
    ]);
    const legacyEnvelope: Record<string, unknown> = {
      tenantId: "t1",
      channel: "telegram",
      provider: "telegram",
      kind: "received",
      data: { from: "+1234", text: "hello world", accountId: "acc-1" },
    };

    await (
      service as unknown as { handleMessage: (m: unknown) => Promise<void> }
    ).handleMessage(
      buildMessage(
        "evt.t1.channel-service.messaging.telegram.telegram.received.v1",
        legacyEnvelope
      )
    );

    expect(executeWorkflow).toHaveBeenCalledTimes(1);
    const [, , , options] = executeWorkflow.mock.calls[0];
    expect(options?.causal).toBeUndefined();
  });

  it("skips (does not throw/nack) a trigger when the matched workflow is disabled", async () => {
    findByTriggerType.mockResolvedValue([
      makeDefinition({
        id: "def-1",
        trigger: sharedTrigger,
        status: WorkflowStatus.DISABLED,
      }),
    ]);
    executeWorkflow.mockRejectedValueOnce(
      new ConflictException({
        statusCode: 409,
        error: "Conflict",
        code: "WORKFLOW_DISABLED",
        message: "Workflow 'def-1' is disabled for tenant 't1'",
        workflowId: "def-1",
        tenantId: "t1",
      })
    );

    // handleMessage must resolve (message acked), never reject/throw —
    // a thrown error here would nack the JetStream message and retry.
    await expect(
      (
        service as unknown as { handleMessage: (m: unknown) => Promise<void> }
      ).handleMessage(
        buildMessage(
          "evt.t1.channel-service.messaging.telegram.telegram.received.v1",
          baseEnvelope
        )
      )
    ).resolves.toBeUndefined();

    expect(executeWorkflow).toHaveBeenCalledTimes(1);
  });

  it("continues triggering remaining workflows after skipping a disabled one", async () => {
    findByTriggerType.mockResolvedValue([
      makeDefinition({
        id: "def-disabled",
        trigger: sharedTrigger,
        status: WorkflowStatus.DISABLED,
      }),
      makeDefinition({
        id: "def-enabled",
        trigger: sharedTrigger,
        status: WorkflowStatus.ENABLED,
      }),
    ]);
    executeWorkflow.mockImplementationOnce(() =>
      Promise.reject(
        new ConflictException({
          statusCode: 409,
          error: "Conflict",
          code: "WORKFLOW_DISABLED",
          message: "Workflow 'def-disabled' is disabled for tenant 't1'",
          workflowId: "def-disabled",
          tenantId: "t1",
        })
      )
    );

    await (
      service as unknown as { handleMessage: (m: unknown) => Promise<void> }
    ).handleMessage(
      buildMessage(
        "evt.t1.channel-service.messaging.telegram.telegram.received.v1",
        baseEnvelope
      )
    );

    expect(executeWorkflow).toHaveBeenCalledTimes(2);
    expect(executeWorkflow.mock.calls[1]?.[0]).toBe("def-enabled");
  });

  it("re-throws (nacks) non-disabled errors from executeWorkflow", async () => {
    findByTriggerType.mockResolvedValue([
      makeDefinition({ id: "def-1", trigger: sharedTrigger }),
    ]);
    executeWorkflow.mockRejectedValueOnce(new Error("temporal unreachable"));

    await expect(
      (
        service as unknown as { handleMessage: (m: unknown) => Promise<void> }
      ).handleMessage(
        buildMessage(
          "evt.t1.channel-service.messaging.telegram.telegram.received.v1",
          baseEnvelope
        )
      )
    ).rejects.toThrow("temporal unreachable");
  });
});
