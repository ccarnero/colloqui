import "../setup-env";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { NatsPublisher, LAZY_NATS } from "../../src/providers/nats.provider";

describe("NatsPublisher", () => {
  let publisher: NatsPublisher;
  const publish = mock(() =>
    Promise.resolve({ seq: 1, duplicate: false, stream: "S" }),
  );
  const streamsInfo = mock(() => Promise.resolve({ config: { name: "S" } }));

  beforeEach(async () => {
    publish.mockClear();
    streamsInfo.mockClear();

    const mockLazy = {
      jetstreamManager: mock(async () => ({
        streams: {
          info: streamsInfo,
        },
      })),
      jetstream: mock(async () => ({ publish })),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NatsPublisher,
        { provide: LAZY_NATS, useValue: mockLazy },
      ],
    }).compile();

    publisher = moduleRef.get(NatsPublisher);
  });

  it("publishAgentPublished calls JetStream publish", async () => {
    const ack = await publisher.publishAgentPublished("ten-1", "ag-1", "Agent");
    expect(ack).not.toBeNull();
    expect(publish).toHaveBeenCalled();
  });

  it("publishSkillChanged publishes correct envelope for created action", async () => {
    const ack = await publisher.publishSkillChanged("ten-1", "sk-1", "created", {
      name: "test-skill",
    });
    expect(ack).not.toBeNull();
    expect(publish).toHaveBeenCalled();

    const callArgs = publish.mock.calls[0] as [string, string];
    const subject = callArgs[0];
    const payload = JSON.parse(callArgs[1]);

    expect(subject).toContain("skill_changed");
    expect(payload.type).toBe("io.yoizen.platform.admin.skill_changed.v1");
    expect(payload.tenant).toBe("ten-1");
    expect(payload.resource).toBe("tenant/ten-1/skills/sk-1");
    expect(payload.data.payload.action).toBe("created");
    expect(payload.data.payload.skillId).toBe("sk-1");
    expect(payload.data.payload.skill).toEqual({ name: "test-skill" });
  });

  it("publishSkillChanged handles all action types", async () => {
    for (const action of ["created", "updated", "deleted"] as const) {
      publish.mockClear();
      await publisher.publishSkillChanged("ten-1", "sk-1", action);
      expect(publish).toHaveBeenCalled();

      const payload = JSON.parse(
        (publish.mock.calls[0] as [string, string])[1],
      );
      expect(payload.data.payload.action).toBe(action);
    }
  });
});
