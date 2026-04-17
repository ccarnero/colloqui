import "reflect-metadata";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { NATS_CONNECTION } from "@yoizen/database";
import type { WorkflowTrigger } from "@yoizen/shared";
import { TriggerConsumerService } from "../../src/modules/triggers/trigger-consumer.service";
import { WorkflowsService } from "../../src/modules/workflows/workflows.service";
import { WorkflowsRepository } from "../../src/modules/workflows/workflows.repository";
import type { IWorkflowDefinitionRow } from "../../src/modules/workflows/workflows.repository";

function makeDefinition(
  overrides: Partial<IWorkflowDefinitionRow> & {
    trigger: WorkflowTrigger;
  },
): IWorkflowDefinitionRow {
  return {
    id: overrides.id ?? "def-1",
    tenant_id: overrides.tenant_id ?? "t1",
    name: overrides.name ?? "wf",
    application: overrides.application ?? "app",
    actions: [],
    trigger: overrides.trigger,
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
  };
}

const sharedTrigger: WorkflowTrigger = {
  type: "message_received",
  mode: "shared",
  config: { channels: ["whatsapp"], providers: ["meta"] },
};

const exclusiveTrigger: WorkflowTrigger = {
  type: "message_received",
  mode: "exclusive",
  config: {},
};

const telegramTrigger: WorkflowTrigger = {
  type: "message_received",
  mode: "shared",
  config: { channels: ["telegram"] },
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
  const findByTriggerType = mock(() => Promise.resolve([] as IWorkflowDefinitionRow[]));
  const executeWorkflow = mock(() =>
    Promise.resolve({
      executionId: "exe-1",
      definitionId: "def-1",
      temporalWorkflowId: "tw-1",
      runId: "run-1",
    }),
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
        {
          provide: WorkflowsService,
          useValue: { executeWorkflow },
        },
        {
          provide: WorkflowsRepository,
          useValue: { findDefinitionsByTriggerType: findByTriggerType },
        },
      ],
    }).compile();

    service = moduleRef.get(TriggerConsumerService);
  });

  function buildMessage(
    subject: string,
    data: Record<string, unknown>,
  ): { subject: string; data: Uint8Array } {
    return {
      subject,
      data: new TextEncoder().encode(JSON.stringify(data)),
    };
  }

  const baseEnvelope = {
    id: "msg-1",
    tenantId: "t1",
    channel: "whatsapp",
    provider: "meta",
    kind: "received",
    data: { from: "+1234", text: "hello world", accountId: "acc-1" },
  };

  it("does nothing when no definitions have triggers", async () => {
    findByTriggerType.mockResolvedValue([]);

    await (service as unknown as { handleMessage: (m: unknown) => Promise<void> })
      .handleMessage(
        buildMessage("evt.t1.channel-service.messaging.whatsapp.meta.received.v1", baseEnvelope),
      );

    expect(executeWorkflow).not.toHaveBeenCalled();
  });

  it("triggers shared workflows that match channel and provider", async () => {
    findByTriggerType.mockResolvedValue([
      makeDefinition({ id: "def-1", trigger: sharedTrigger }),
      makeDefinition({ id: "def-2", trigger: sharedTrigger }),
    ]);

    await (service as unknown as { handleMessage: (m: unknown) => Promise<void> })
      .handleMessage(
        buildMessage("evt.t1.channel-service.messaging.whatsapp.meta.received.v1", baseEnvelope),
      );

    expect(executeWorkflow).toHaveBeenCalledTimes(2);
  });

  it("filters out workflows that do not match channel", async () => {
    findByTriggerType.mockResolvedValue([
      makeDefinition({ id: "def-1", trigger: telegramTrigger }),
    ]);

    await (service as unknown as { handleMessage: (m: unknown) => Promise<void> })
      .handleMessage(
        buildMessage("evt.t1.channel-service.messaging.whatsapp.meta.received.v1", baseEnvelope),
      );

    expect(executeWorkflow).not.toHaveBeenCalled();
  });

  it("only fires one exclusive workflow when present", async () => {
    findByTriggerType.mockResolvedValue([
      makeDefinition({ id: "excl-1", trigger: exclusiveTrigger }),
      makeDefinition({ id: "shared-1", trigger: sharedTrigger }),
    ]);

    await (service as unknown as { handleMessage: (m: unknown) => Promise<void> })
      .handleMessage(
        buildMessage("evt.t1.channel-service.messaging.whatsapp.meta.received.v1", baseEnvelope),
      );

    expect(executeWorkflow).toHaveBeenCalledTimes(1);
  });

  it("matches text patterns when configured", async () => {
    findByTriggerType.mockResolvedValue([
      makeDefinition({ id: "pat-1", trigger: patternTrigger }),
    ]);

    await (service as unknown as { handleMessage: (m: unknown) => Promise<void> })
      .handleMessage(
        buildMessage("evt.t1.channel-service.messaging.whatsapp.meta.received.v1", baseEnvelope),
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

    await (service as unknown as { handleMessage: (m: unknown) => Promise<void> })
      .handleMessage(
        buildMessage("evt.t1.channel-service.messaging.whatsapp.meta.received.v1", noMatchEnvelope),
      );

    expect(executeWorkflow).not.toHaveBeenCalled();
  });

  it("triggers workflow when accountIds matches the envelope accountId", async () => {
    findByTriggerType.mockResolvedValue([
      makeDefinition({ id: "acc-match", trigger: accountTriggerMatch }),
    ]);

    await (service as unknown as { handleMessage: (m: unknown) => Promise<void> })
      .handleMessage(
        buildMessage("evt.t1.channel-service.messaging.whatsapp.meta.received.v1", baseEnvelope),
      );

    expect(executeWorkflow).toHaveBeenCalledTimes(1);
  });

  it("skips workflow when accountIds does not include the envelope accountId", async () => {
    findByTriggerType.mockResolvedValue([
      makeDefinition({ id: "acc-miss", trigger: accountTriggerMiss }),
    ]);

    await (service as unknown as { handleMessage: (m: unknown) => Promise<void> })
      .handleMessage(
        buildMessage("evt.t1.channel-service.messaging.whatsapp.meta.received.v1", baseEnvelope),
      );

    expect(executeWorkflow).not.toHaveBeenCalled();
  });
});
