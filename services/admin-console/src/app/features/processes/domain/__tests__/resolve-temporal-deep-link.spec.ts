import { describe, expect, it } from "vitest";
import { resolveTemporalDeepLink } from "../resolve-temporal-deep-link";

describe("resolveTemporalDeepLink", () => {
  it("builds the same URL shape as the legacy tab's temporalUrl()", () => {
    const url = resolveTemporalDeepLink({
      temporalUiBaseUrl: "http://localhost:8233",
      temporalNamespace: "default",
      workflowId: "acme:order-workflow:abc123",
    });
    expect(url).toBe(
      "http://localhost:8233/namespaces/default/workflows/acme%3Aorder-workflow%3Aabc123"
    );
  });

  it("URL-encodes the workflow id", () => {
    const url = resolveTemporalDeepLink({
      temporalUiBaseUrl: "http://localhost:8233",
      temporalNamespace: "default",
      workflowId: "acme:order workflow/abc 123",
    });
    expect(url).not.toContain(" ");
    expect(url).toContain(encodeURIComponent("acme:order workflow/abc 123"));
  });

  it("returns null when the base URL is not configured", () => {
    const url = resolveTemporalDeepLink({
      temporalUiBaseUrl: "",
      temporalNamespace: "default",
      workflowId: "acme:order-workflow:abc123",
    });
    expect(url).toBeNull();
  });

  it("returns null when the workflow id is missing", () => {
    const url = resolveTemporalDeepLink({
      temporalUiBaseUrl: "http://localhost:8233",
      temporalNamespace: "default",
      workflowId: null,
    });
    expect(url).toBeNull();
  });

  it("never produces a URL containing the literal 'null' or 'undefined'", () => {
    const url = resolveTemporalDeepLink({
      temporalUiBaseUrl: "http://localhost:8233",
      temporalNamespace: "default",
      workflowId: null,
    });
    expect(url).toBeNull();
  });
});
