import { describe, expect, it } from "bun:test";
import { parseRunPathSegments } from "../../src/modules/tracking/parse-run-path-segments";

describe("parseRunPathSegments", () => {
  it("extracts and decodes a simple workflowId/runId pair", () => {
    expect(parseRunPathSegments("/api/tracking/runs/wf-1/run-1")).toEqual({
      workflowId: "wf-1",
      runId: "run-1",
    });
  });

  it("decodes a percent-encoded colon-bearing workflowId (composite id shape acme:name:sha256:...:id)", () => {
    const url =
      "/api/v1/tracking/runs/acme%3Ae2e-http-log%3Asha256%3Adeadbeef%3Aid/019f54b5-abcd";
    expect(parseRunPathSegments(url)).toEqual({
      workflowId: "acme:e2e-http-log:sha256:deadbeef:id",
      runId: "019f54b5-abcd",
    });
  });

  it("decodes a raw (unencoded) colon-bearing workflowId the same way", () => {
    const url =
      "/api/tracking/runs/acme:e2e-http-log:sha256:deadbeef:id/019f54b5-abcd";
    expect(parseRunPathSegments(url)).toEqual({
      workflowId: "acme:e2e-http-log:sha256:deadbeef:id",
      runId: "019f54b5-abcd",
    });
  });

  it("strips the query string before parsing", () => {
    const url = "/api/tracking/runs/wf-1/run-1?foo=bar";
    expect(parseRunPathSegments(url)).toEqual({
      workflowId: "wf-1",
      runId: "run-1",
    });
  });

  it("returns null when there is only one segment after runs/", () => {
    expect(parseRunPathSegments("/api/tracking/runs/only-one")).toBeNull();
  });

  it("returns null when there are more than two segments after runs/", () => {
    expect(
      parseRunPathSegments("/api/tracking/runs/wf-1/run-1/extra")
    ).toBeNull();
  });

  it("returns null when the URL has no runs/ segment", () => {
    expect(parseRunPathSegments("/api/tracking/chains/corr-1")).toBeNull();
  });

  it("returns null on a malformed percent-encoding", () => {
    expect(
      parseRunPathSegments("/api/tracking/runs/%E0%A4%A/run-1")
    ).toBeNull();
  });
});
