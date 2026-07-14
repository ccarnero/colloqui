import { describe, expect, it } from "bun:test";
import { parseInvokeRequestBody } from "../../src/lib/http-facade/parse-invoke-request-body";

describe("parseInvokeRequestBody", () => {
  it("builds EndpointCallArgs from connectorId/endpointId + args", () => {
    const result = parseInvokeRequestBody("adp-1", "ep-1", {
      args: { method: "GET", params: { q: "1" } },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        mode: "sync",
        args: {
          method: "GET",
          url: "",
          adapterId: "adp-1",
          endpointId: "ep-1",
          params: { q: "1" },
        },
      });
    }
  });

  it("defaults mode to sync when omitted", () => {
    const result = parseInvokeRequestBody("adp-1", "ep-1", {
      args: { method: "POST" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mode).toBe("sync");
    }
  });

  it("passes through headers and data", () => {
    const result = parseInvokeRequestBody("adp-1", "ep-1", {
      args: {
        method: "POST",
        data: { hello: "world" },
        headers: { "x-custom": "1" },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.args.data).toEqual({ hello: "world" });
      expect(result.value.args.headers).toEqual({ "x-custom": "1" });
    }
  });

  it("rejects a non-object body", () => {
    const result = parseInvokeRequestBody("adp-1", "ep-1", "nope");
    expect(result.ok).toBe(false);
  });

  it("rejects a missing args object", () => {
    const result = parseInvokeRequestBody("adp-1", "ep-1", {});
    expect(result.ok).toBe(false);
  });

  it("rejects a missing/blank method", () => {
    const result = parseInvokeRequestBody("adp-1", "ep-1", {
      args: { method: "" },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects unsupported modes", () => {
    const result = parseInvokeRequestBody("adp-1", "ep-1", {
      args: { method: "GET" },
      mode: "yolo",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("yolo");
    }
  });

  // --- mode: "async" (T04) ---

  it("accepts mode: async", () => {
    const result = parseInvokeRequestBody("adp-1", "ep-1", {
      args: { method: "GET" },
      mode: "async",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mode).toBe("async");
    }
  });

  it("passes through an idempotencyKey for async mode", () => {
    const result = parseInvokeRequestBody("adp-1", "ep-1", {
      args: { method: "GET" },
      mode: "async",
      idempotencyKey: "client-retry-key-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.idempotencyKey).toBe("client-retry-key-1");
    }
  });

  it("rejects a blank idempotencyKey", () => {
    const result = parseInvokeRequestBody("adp-1", "ep-1", {
      args: { method: "GET" },
      mode: "async",
      idempotencyKey: "   ",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-string idempotencyKey", () => {
    const result = parseInvokeRequestBody("adp-1", "ep-1", {
      args: { method: "GET" },
      mode: "async",
      idempotencyKey: 123,
    });
    expect(result.ok).toBe(false);
  });

  it("omits idempotencyKey from the result when not provided", () => {
    const result = parseInvokeRequestBody("adp-1", "ep-1", {
      args: { method: "GET" },
      mode: "async",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect("idempotencyKey" in result.value).toBe(false);
    }
  });

  // --- webhook (T05) ---

  it("accepts a webhook target for mode: async", () => {
    const result = parseInvokeRequestBody("adp-1", "ep-1", {
      args: { method: "GET" },
      mode: "async",
      webhook: { url: "https://caller.example/hook", headers: { "x-a": "1" } },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.webhook).toEqual({
        url: "https://caller.example/hook",
        headers: { "x-a": "1" },
      });
    }
  });

  it("rejects webhook for mode: sync", () => {
    const result = parseInvokeRequestBody("adp-1", "ep-1", {
      args: { method: "GET" },
      webhook: { url: "https://caller.example/hook" },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a webhook without a url", () => {
    const result = parseInvokeRequestBody("adp-1", "ep-1", {
      args: { method: "GET" },
      mode: "async",
      webhook: { headers: { "x-a": "1" } },
    });
    expect(result.ok).toBe(false);
  });

  it("omits webhook from the result when not provided", () => {
    const result = parseInvokeRequestBody("adp-1", "ep-1", {
      args: { method: "GET" },
      mode: "async",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect("webhook" in result.value).toBe(false);
    }
  });

  // --- webhook SSRF guard (T05 security fix) ---

  it("rejects a webhook.url targeting the cloud metadata endpoint", () => {
    const result = parseInvokeRequestBody("adp-1", "ep-1", {
      args: { method: "GET" },
      mode: "async",
      webhook: { url: "http://169.254.169.254/latest/meta-data" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("webhook.url is invalid");
    }
  });

  it("rejects a webhook.url targeting localhost", () => {
    const result = parseInvokeRequestBody("adp-1", "ep-1", {
      args: { method: "GET" },
      mode: "async",
      webhook: { url: "http://localhost:8080/hook" },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a webhook.url targeting an RFC1918 private address", () => {
    const result = parseInvokeRequestBody("adp-1", "ep-1", {
      args: { method: "GET" },
      mode: "async",
      webhook: { url: "http://10.0.0.5/hook" },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a webhook.url with a non-http(s) scheme", () => {
    const result = parseInvokeRequestBody("adp-1", "ep-1", {
      args: { method: "GET" },
      mode: "async",
      webhook: { url: "ftp://caller.example/hook" },
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a public https webhook.url", () => {
    const result = parseInvokeRequestBody("adp-1", "ep-1", {
      args: { method: "GET" },
      mode: "async",
      webhook: { url: "https://caller.example/hook" },
    });
    expect(result.ok).toBe(true);
  });
});
