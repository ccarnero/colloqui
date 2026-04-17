import { describe, it, expect } from "bun:test";
import {
  JETSTREAM_MANAGER,
  JETSTREAM_PUBLISHER,
  jetStreamManagerProvider,
  jetStreamPublisherProvider,
  natsProvider,
} from "../../src/providers/nats.provider";

describe("nats.provider", () => {
  it("exports stable injection tokens", () => {
    expect(JETSTREAM_MANAGER).toBe("JETSTREAM_MANAGER");
    expect(JETSTREAM_PUBLISHER).toBe("JETSTREAM_PUBLISHER");
  });

  it("registers NATS and JetStream factory providers", () => {
    expect(natsProvider.provide).toBeDefined();
    expect(jetStreamManagerProvider.provide).toBe(JETSTREAM_MANAGER);
    expect(jetStreamPublisherProvider.provide).toBe(JETSTREAM_PUBLISHER);
  });
});
