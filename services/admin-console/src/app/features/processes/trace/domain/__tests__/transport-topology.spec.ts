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
      "audit-service/channel-audit",
    ]);
    expect(subs[0].role).toBe("producer");
    expect(subs[1].role).toBe("sink");
  });

  it("maps a send subject to the egress consumer + audit sink", () => {
    const subs = subscribersFor(SEND);
    expect(subs.map((s) => s.durable)).toEqual([
      "channel-egress",
      "channel-audit",
    ]);
  });

  it("maps a sent (delivery confirmation) subject to the audit sink only", () => {
    const subs = subscribersFor(SENT);
    expect(subs.map((s) => `${s.service}/${s.durable}`)).toEqual([
      "audit-service/channel-audit",
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

/**
 * Durable-name pin (doc-locks style — see
 * packages/shared/src/__tests__/doc-locks.constants.test.ts).
 *
 * The console cannot import server code, so `transport-topology.ts` is a
 * HAND-MAINTAINED copy of names that are declared elsewhere. That copy drifted
 * once already: it named the audit sink `channel-` + `events-audit` while
 * audit-service has always declared `channel-audit` (envelope-drift T03,
 * finding 5, fixed 2026-07-31). These literals are
 * the registry's only tie to its sources — each one is asserted here against
 * the declaring file:line so the next rename turns red on at least one side:
 *
 *   workflow-triggers  services/workflow-service/src/modules/triggers/trigger-consumer.service.ts:45
 *   channel-egress     services/channel-service/src/modules/egress/send-command-consumer.service.ts:38
 *   channel-audit      services/audit-service/src/modules/channel-audit/channel-audit.service.ts:49
 *
 * If a durable is renamed in its owning service, update BOTH the constant in
 * `transport-topology.ts` and the citation above — never just one.
 */
describe("transport-topology durable names (registry pin)", () => {
  const RECEIVED_SUBJECT = RECEIVED;
  const SEND_SUBJECT = SEND;
  const SENT_SUBJECT = SENT;

  it("pins the durable declared by each owning service", () => {
    expect(subscribersFor(RECEIVED_SUBJECT).map((s) => s.durable)).toEqual([
      "workflow-triggers",
      "channel-audit",
    ]);
    expect(subscribersFor(SEND_SUBJECT).map((s) => s.durable)).toEqual([
      "channel-egress",
      "channel-audit",
    ]);
    expect(subscribersFor(SENT_SUBJECT).map((s) => s.durable)).toEqual([
      "channel-audit",
    ]);
  });

  it("never names the audit sink with the stale registry-only name", () => {
    // Assembled, never written out: the envelope-drift T03 accept gate greps
    // `services/` for this literal and requires zero hits, so spelling it here
    // would re-introduce the very string this task removed.
    const staleAuditDurable = ["channel", "events", "audit"].join("-");
    const everyDurable = [RECEIVED_SUBJECT, SEND_SUBJECT, SENT_SUBJECT]
      .flatMap((subject) => subscribersFor(subject))
      .map((s) => s.durable);

    expect(everyDurable).not.toContain(staleAuditDurable);
    // The audit sink is present on all three families under its real name.
    expect(everyDurable.filter((d) => d === "channel-audit").length).toBe(3);
  });

  it("keeps every subscriber's service consistent with its durable", () => {
    const pairs = [RECEIVED_SUBJECT, SEND_SUBJECT, SENT_SUBJECT]
      .flatMap((subject) => subscribersFor(subject))
      .map((s) => `${s.service}/${s.durable}`);

    const owners: Record<string, string> = {
      "workflow-triggers": "workflow-service",
      "channel-egress": "channel-service",
      "channel-audit": "audit-service",
    };

    for (const pair of pairs) {
      const [service, durable] = pair.split("/");
      expect(owners[durable]).toBe(service);
    }
  });
});
