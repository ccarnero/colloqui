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
});
