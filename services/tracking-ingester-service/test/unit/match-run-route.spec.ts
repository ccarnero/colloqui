import { describe, expect, it } from "bun:test";
import { matchRunRoute } from "../../src/lib/match-run-route.js";

describe("matchRunRoute", () => {
  it("matches /runs/:workflowId/:runId", () => {
    expect(matchRunRoute("/runs/wf-1/run-1")).toEqual({
      workflowId: "wf-1",
      runId: "run-1",
    });
  });

  it("URL-decodes both ids", () => {
    expect(matchRunRoute("/runs/wf%201/run%202")).toEqual({
      workflowId: "wf 1",
      runId: "run 2",
    });
  });

  it("returns null for /runs with no ids or only one id", () => {
    expect(matchRunRoute("/runs")).toBeNull();
    expect(matchRunRoute("/runs/")).toBeNull();
    expect(matchRunRoute("/runs/wf-1")).toBeNull();
    expect(matchRunRoute("/runs/wf-1/")).toBeNull();
  });

  it("returns null for nested/unrelated paths", () => {
    expect(matchRunRoute("/runs/wf-1/run-1/extra")).toBeNull();
    expect(matchRunRoute("/chains/corr-1")).toBeNull();
    expect(matchRunRoute("/health")).toBeNull();
    expect(matchRunRoute("/")).toBeNull();
  });
});
