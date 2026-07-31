import "../setup-env";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { ServiceUnavailableException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  CHANNEL_STREAM_MAX_AGE_NS,
  CHANNEL_STREAM_MAX_BYTES,
  TENANT_TIER_LIMITS,
} from "@yoizen/shared";
import { NatsPublisher, LAZY_NATS } from "../../src/providers/nats.provider";

describe("NatsPublisher", () => {
  let publisher: NatsPublisher;
  const publish = mock(() =>
    Promise.resolve({ seq: 1, duplicate: false, stream: "S" }),
  );
  const streamsInfo = mock(() => Promise.resolve({ config: { name: "S" } }));
  const streamsAdd = mock((_cfg: Record<string, unknown>) =>
    Promise.resolve({}),
  );
  const getAccountInfo = mock(async () => ({
    storage: 0,
    limits: { max_storage: 10_000_000_000 },
  }));

  beforeEach(async () => {
    publish.mockClear();
    streamsInfo.mockClear();
    streamsAdd.mockClear();
    getAccountInfo.mockClear();

    const mockLazy = {
      jetstreamManager: mock(async () => ({
        streams: {
          info: streamsInfo,
          add: streamsAdd,
        },
        getAccountInfo,
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

  // envelope-drift post-loop item 6 — single stream creator.
  // This service used to create INGRESS-<TENANT> itself from
  // `buildTenantStreamConfig(tenantId, "free")`, while packages/database's
  // `ensureTenantIngressStream` created the SAME stream with flat limits.
  // Whichever service touched a new tenant first won. It now delegates, so
  // only the flat config is ever sent.
  it("creates the ingress stream with the FLAT config, never tier limits", async () => {
    await publisher.publishAgentPublished("tenant-single-creator", "a-1", "A");

    expect(streamsAdd).toHaveBeenCalledTimes(1);
    const [cfg] = streamsAdd.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(cfg.max_bytes).toBe(CHANNEL_STREAM_MAX_BYTES);
    expect(cfg.max_age).toBe(CHANNEL_STREAM_MAX_AGE_NS);
    // The tier path always set these; the flat path never does.
    expect("max_msg_size" in cfg).toBe(false);
    expect("num_replicas" in cfg).toBe(false);
    expect(cfg.max_bytes).not.toBe(TENANT_TIER_LIMITS.free.max_bytes);
    // No hand-rolled existence probe either — the helper is add-first.
    expect(streamsInfo).not.toHaveBeenCalled();
  });

  it("maps a capacity shortfall to a 503 (ServiceUnavailableException)", async () => {
    // JetStreamCapacityError from the shared helper must keep surfacing as the
    // 503 this service returned when it owned the capacity pre-flight.
    getAccountInfo.mockImplementation(async () => ({
      storage: 0,
      limits: { max_storage: 1 },
    }));

    await expect(
      publisher.publishAgentPublished("tenant-no-room", "a-2", "A"),
    ).rejects.toThrow(ServiceUnavailableException);

    expect(streamsAdd).not.toHaveBeenCalled();

    getAccountInfo.mockImplementation(async () => ({
      storage: 0,
      limits: { max_storage: 10_000_000_000 },
    }));
  });
});
