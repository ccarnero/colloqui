import { describe, expect, it } from "vitest";
import { projectHttpPayload } from "../project-http-payload";

const fullPayload = {
  method: "POST",
  resolvedUrl: "https://api.example.com/orders",
  status: 201,
  durationMs: 87,
  cacheResult: "bypass",
  requestHeaders: { "content-type": "application/json" },
  requestBody: { id: 1 },
  responseHeaders: { "x-trace": "abc" },
  responseBody: { ok: true },
};

describe("projectHttpPayload", () => {
  it("projects the request side (method, url, request headers/body)", () => {
    const proj = projectHttpPayload(fullPayload, "request");
    expect(proj.side).toBe("request");
    expect(proj.rows).toEqual([
      { label: "method", value: "POST" },
      { label: "url", value: "https://api.example.com/orders" },
    ]);
    expect(proj.headers).toBe("content-type: application/json");
    expect(proj.body).toBe(JSON.stringify({ id: 1 }, null, 2));
  });

  it("projects the response side (status, duration, cache, response headers/body)", () => {
    const proj = projectHttpPayload(fullPayload, "response");
    expect(proj.side).toBe("response");
    expect(proj.rows).toEqual([
      { label: "status", value: "201" },
      { label: "duration", value: "87 ms" },
      { label: "cache", value: "bypass" },
    ]);
    expect(proj.headers).toBe("x-trace: abc");
    expect(proj.body).toBe(JSON.stringify({ ok: true }, null, 2));
  });

  it("does NOT leak response fields into the request projection (and vice versa)", () => {
    const req = projectHttpPayload(fullPayload, "request");
    expect(req.rows.some((r) => r.label === "status")).toBe(false);
    expect(req.body).not.toContain("ok");

    const res = projectHttpPayload(fullPayload, "response");
    expect(res.rows.some((r) => r.label === "method")).toBe(false);
    expect(res.body).not.toContain('"id"');
  });

  it("omits absent fields instead of rendering blanks", () => {
    const proj = projectHttpPayload(
      { method: "GET", resolvedUrl: "https://x/y" },
      "request"
    );
    expect(proj.rows).toEqual([
      { label: "method", value: "GET" },
      { label: "url", value: "https://x/y" },
    ]);
    expect(proj.headers).toBeNull();
    expect(proj.body).toBeNull();
  });

  it("keeps a string body verbatim", () => {
    const proj = projectHttpPayload(
      { responseBody: "plain text response" },
      "response"
    );
    expect(proj.body).toBe("plain text response");
  });

  it("returns an all-empty projection for a non-object payload", () => {
    const proj = projectHttpPayload(null, "request");
    expect(proj.rows).toEqual([]);
    expect(proj.headers).toBeNull();
    expect(proj.body).toBeNull();
  });
});
