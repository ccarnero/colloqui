import { subscribersFor } from "../transport-topology";

const RECEIVED =
  "evt.acme.channel-service.messaging.telegram.telegram.received.v1";
const SEND = "evt.acme.channel-service.messaging.telegram.telegram.send.v1";
const SENT = "evt.acme.channel-service.messaging.telegram.telegram.sent.v1";

describe("subscribersFor", () => {
  it("maps a received subject to the trigger consumer + audit sink", () => {
    const subs = subscribersFor(RECEIVED);
    expect(subs.map((s) => `${s.service}/${s.durable}`)).toEqual([
      "workflow-service/workflow-triggers",
      "audit-service/channel-events-audit",
    ]);
    expect(subs[0].role).toBe("producer");
    expect(subs[1].role).toBe("sink");
  });

  it("maps a send subject to the egress consumer + audit sink", () => {
    const subs = subscribersFor(SEND);
    expect(subs.map((s) => s.durable)).toEqual([
      "channel-egress",
      "channel-events-audit",
    ]);
  });

  it("maps a sent (delivery confirmation) subject to the audit sink only", () => {
    const subs = subscribersFor(SENT);
    expect(subs.map((s) => `${s.service}/${s.durable}`)).toEqual([
      "audit-service/channel-events-audit",
    ]);
    expect(subs.every((s) => s.role === "sink")).toBe(true);
    // channel-egress consumes `send`, never `sent`.
    expect(subs.some((s) => s.durable === "channel-egress")).toBe(false);
  });

  it("returns [] for an unknown subject", () => {
    expect(subscribersFor("evt.acme.foo.bar.baz.qux.unknown.v1")).toEqual([]);
    expect(subscribersFor("")).toEqual([]);
  });
});
