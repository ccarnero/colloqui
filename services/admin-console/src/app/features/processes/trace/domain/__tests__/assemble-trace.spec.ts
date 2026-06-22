import { assembleTrace } from "../assemble-trace";
import type { ITraceNodeInput } from "../message-trace.model";

function node(
  id: string,
  kind: string,
  causationId: string | null,
  depth: number,
  createdAt: string,
  extra: Partial<ITraceNodeInput> = {},
): ITraceNodeInput {
  const subjectKind = kind === "received" ? "received" : "send";
  return {
    id,
    kind,
    subject: `evt.acme.channel-service.messaging.telegram.telegram.${subjectKind}.v1`,
    causationId,
    depth,
    createdAt,
    source: "channel",
    ...extra,
  };
}

describe("assembleTrace", () => {
  it("returns an empty result for no rows (no throw)", () => {
    const r = assembleTrace("cid", []);
    expect(r.verdict).toBe("empty");
    expect(r.root).toBeNull();
    expect(r.nodeCount).toBe(0);
  });

  it("received-only -> verdict 'received', single root", () => {
    const r = assembleTrace("cid", [
      node("a", "received", null, 0, "2026-06-24T18:34:09.247Z"),
    ]);
    expect(r.verdict).toBe("received");
    expect(r.root?.id).toBe("a");
    expect(r.nodeCount).toBe(1);
  });

  it("received -> send links causally and verdict is 'published-unconfirmed'", () => {
    const r = assembleTrace("cid", [
      node("snd", "send", "rcv", 2, "2026-06-24T18:34:09.359Z"),
      node("rcv", "received", null, 0, "2026-06-24T18:34:09.247Z"),
    ]);
    expect(r.root?.id).toBe("rcv");
    expect(r.nodes.map((n) => n.id)).toEqual(["rcv", "snd"]);
    expect(r.root?.children[0]?.id).toBe("snd");
    expect(r.verdict).toBe("published-unconfirmed");
  });

  it("a confirmed 'sent' event -> verdict 'replied' (real received->send->sent chain)", () => {
    const r = assembleTrace("cid", [
      node("rcv", "received", null, 1, "2026-06-25T14:55:13.794Z"),
      node("snd", "send", "rcv", 2, "2026-06-25T14:55:14.004Z"),
      node("snt", "sent", "snd", 3, "2026-06-25T14:55:15.077Z"),
    ]);
    expect(r.verdict).toBe("replied");
    expect(r.nodes.map((n) => n.id)).toEqual(["rcv", "snd", "snt"]);
  });

  it("a delivered send -> verdict 'replied'", () => {
    const r = assembleTrace("cid", [
      node("rcv", "received", null, 0, "2026-06-24T18:34:09.247Z"),
      node("snd", "send", "rcv", 2, "2026-06-24T18:34:09.359Z", {
        delivery: "delivered",
      }),
    ]);
    expect(r.verdict).toBe("replied");
  });

  it("attaches pub/sub subscribers and counts deliveries", () => {
    const r = assembleTrace("cid", [
      node("rcv", "received", null, 0, "2026-06-24T18:34:09.247Z"),
      node("snd", "send", "rcv", 2, "2026-06-24T18:34:09.359Z"),
    ]);
    const rcv = r.nodes.find((n) => n.id === "rcv");
    expect(rcv?.subscribers.map((s) => s.durable)).toEqual([
      "workflow-triggers",
      "channel-events-audit",
    ]);
    expect(r.deliveryCount).toBe(4);
  });

  it("treats an orphan (parent absent) as a root", () => {
    const r = assembleTrace("cid", [
      node("snd", "send", "missing-parent", 2, "2026-06-24T18:34:09.359Z"),
    ]);
    expect(r.root?.id).toBe("snd");
  });
});
