import { describe, expect, it } from "vitest";
import type { IConnectorCall } from "../../../../../core/services/connector-call.service";
import { matchEndpointCalls } from "../match-endpoint-calls";
import type { IStepEventPair } from "../resolve-step-events";
import type { ILayoutNode } from "../run-view.model";

function node(overrides: Partial<ILayoutNode> = {}): ILayoutNode {
  return {
    id: "root::0",
    kind: "action",
    color: "platform",
    label: "1 · endpointCall → order-api",
    status: "ok",
    row: 0,
    lane: 0,
    onSpine: true,
    nestingDepth: 0,
    durationMs: 120,
    dashed: false,
    instanceId: "order-api",
    evaluatedValue: null,
    branchTaken: null,
    actionType: "endpointCall",
    stepName: "callOrderApi",
    conditionEventId: null,
    ...overrides,
  };
}

const pair: IStepEventPair = {
  started: { eventId: "evt-started", occurredAt: "2026-07-11T10:00:00.000Z" },
  completed: {
    eventId: "evt-completed",
    occurredAt: "2026-07-11T10:00:02.000Z",
  },
};

function call(overrides: Partial<IConnectorCall> = {}): IConnectorCall {
  return {
    adapterId: "order-api",
    endpointId: null,
    method: "GET",
    resolvedUrl: "https://api.example.com/orders/1",
    status: 200,
    durationMs: 42,
    cacheResult: "miss",
    timestamp: "2026-07-11T10:00:01.000Z",
    correlationId: "corr-1",
    eventId: "evt-http-1",
    ...overrides,
  };
}

describe("matchEndpointCalls", () => {
  it("matches the endpoint_call event by adapter + correlation + window", () => {
    const result = matchEndpointCalls(node(), pair, [call()], "corr-1");
    expect(result).toEqual([
      {
        eventId: "evt-http-1",
        method: "GET",
        resolvedUrl: "https://api.example.com/orders/1",
        status: 200,
        durationMs: 42,
        cacheResult: "miss",
        occurredAt: "2026-07-11T10:00:01.000Z",
      },
    ]);
  });

  it("returns nothing for a non-endpointCall step", () => {
    expect(
      matchEndpointCalls(
        node({ actionType: "agentCall", instanceId: "agent-1" }),
        pair,
        [call()],
        "corr-1"
      )
    ).toEqual([]);
  });

  it("returns nothing when the node has no resolved adapter id", () => {
    expect(
      matchEndpointCalls(node({ instanceId: null }), pair, [call()], "corr-1")
    ).toEqual([]);
  });

  it("excludes calls from a different correlation", () => {
    expect(
      matchEndpointCalls(
        node(),
        pair,
        [call({ correlationId: "corr-other" })],
        "corr-1"
      )
    ).toEqual([]);
  });

  it("excludes calls to a different adapter", () => {
    expect(
      matchEndpointCalls(
        node(),
        pair,
        [call({ adapterId: "other-api" })],
        "corr-1"
      )
    ).toEqual([]);
  });

  it("excludes calls outside the step's started/completed window", () => {
    expect(
      matchEndpointCalls(
        node(),
        pair,
        [call({ timestamp: "2026-07-11T10:05:00.000Z" })],
        "corr-1"
      )
    ).toEqual([]);
  });

  it("excludes rows with no eventId (cannot fetch a payload without it)", () => {
    const { eventId: _drop, ...noId } = call();
    void _drop;
    expect(
      matchEndpointCalls(node(), pair, [noId as IConnectorCall], "corr-1")
    ).toEqual([]);
  });

  it("returns ALL matches for a branch fan-out, sorted by occurredAt", () => {
    const first = call({
      eventId: "evt-http-a",
      resolvedUrl: "https://api.example.com/a",
      timestamp: "2026-07-11T10:00:00.500Z",
    });
    const second = call({
      eventId: "evt-http-b",
      resolvedUrl: "https://api.example.com/b",
      status: 500,
      timestamp: "2026-07-11T10:00:01.500Z",
    });
    const result = matchEndpointCalls(node(), pair, [second, first], "corr-1");
    expect(result.map((m) => m.eventId)).toEqual(["evt-http-a", "evt-http-b"]);
    expect(result[1]?.status).toBe(500);
  });
});
