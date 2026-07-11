import { describe, expect, it } from "bun:test";
import { matchPayloadRoute } from "../../src/lib/match-payload-route.js";

describe("matchPayloadRoute", () => {
  it("matches /chains/:correlationId/events/:eventId/payload", () => {
    expect(matchPayloadRoute("/chains/corr-1/events/evt-1/payload")).toEqual({
      correlationId: "corr-1",
      eventId: "evt-1",
    });
  });

  it("URL-decodes both captured ids", () => {
    expect(
      matchPayloadRoute("/chains/corr%201/events/evt%202/payload")
    ).toEqual({
      correlationId: "corr 1",
      eventId: "evt 2",
    });
  });

  it("allows a trailing slash", () => {
    expect(matchPayloadRoute("/chains/corr-1/events/evt-1/payload/")).toEqual({
      correlationId: "corr-1",
      eventId: "evt-1",
    });
  });

  it("returns null for the chain route (no /events/:id/payload suffix)", () => {
    expect(matchPayloadRoute("/chains/corr-1")).toBeNull();
  });

  it("returns null for missing eventId", () => {
    expect(matchPayloadRoute("/chains/corr-1/events//payload")).toBeNull();
    expect(matchPayloadRoute("/chains/corr-1/events/payload")).toBeNull();
  });

  it("returns null for missing correlationId", () => {
    expect(matchPayloadRoute("/chains//events/evt-1/payload")).toBeNull();
  });

  it("returns null for unrelated paths", () => {
    expect(matchPayloadRoute("/health")).toBeNull();
    expect(matchPayloadRoute("/")).toBeNull();
    expect(
      matchPayloadRoute("/chains/corr-1/events/evt-1/payload/extra")
    ).toBeNull();
  });
});
