import "../setup-env";
import { describe, expect, it } from "bun:test";
import { McpToolsProbeService } from "../../src/modules/mcp-servers/mcp-tools-probe.service";

/**
 * Covers the SSRF guard in `McpToolsProbeService`'s private `validateUrl`,
 * extended with an explicit `scope` parameter (mcp-connections.md
 * SSRF-scope follow-up). `scope: "internal"` is an admin opt-in that
 * relaxes the localhost/RFC1918 checks; cloud-metadata and link-local
 * targets stay blocked regardless of scope. `validateUrl` is private, so
 * it's invoked here via a cast, same shape as calling it through `connect`.
 */
describe("McpToolsProbeService.validateUrl — SSRF guard scope semantics", () => {
  const service = new McpToolsProbeService();
  const callValidateUrl = (url: string, scope?: "external" | "internal") =>
    (
      service as unknown as { validateUrl: (u: string, s?: string) => void }
    ).validateUrl(url, scope);

  describe("external scope (default) — unchanged regression behavior", () => {
    it("accepts a public https URL", () => {
      expect(() =>
        callValidateUrl("https://api.example.com/mcp")
      ).not.toThrow();
    });

    it("rejects localhost", () => {
      expect(() => callValidateUrl("http://localhost:3000/mcp")).toThrow(
        "must not target localhost"
      );
    });

    it("rejects 10.x.x.x (RFC1918 private)", () => {
      expect(() => callValidateUrl("http://10.0.0.5/mcp")).toThrow(
        "private/RFC1918"
      );
    });

    it("rejects 192.168.x.x (RFC1918 private)", () => {
      expect(() => callValidateUrl("http://192.168.1.10/mcp")).toThrow(
        "private/RFC1918"
      );
    });

    it("rejects 169.254.169.254 (cloud metadata)", () => {
      expect(() =>
        callValidateUrl("http://169.254.169.254/latest/meta-data")
      ).toThrow("cloud metadata");
    });

    it("rejects 169.254.x.x (link-local)", () => {
      expect(() => callValidateUrl("http://169.254.1.1/mcp")).toThrow(
        "link-local"
      );
    });

    it("behaves the same when scope is explicitly 'external'", () => {
      expect(() => callValidateUrl("http://10.0.0.5/mcp", "external")).toThrow(
        "private/RFC1918"
      );
    });
  });

  describe("internal scope — explicit opt-in relaxation", () => {
    it("allows 10.x.x.x", () => {
      expect(() =>
        callValidateUrl("http://10.0.0.5/mcp", "internal")
      ).not.toThrow();
    });

    it("allows 192.168.x.x", () => {
      expect(() =>
        callValidateUrl("http://192.168.1.10/mcp", "internal")
      ).not.toThrow();
    });

    it("allows localhost", () => {
      expect(() =>
        callValidateUrl("http://localhost:3000/mcp", "internal")
      ).not.toThrow();
    });

    it("still blocks 169.254.169.254 (cloud metadata)", () => {
      expect(() =>
        callValidateUrl("http://169.254.169.254/latest/meta-data", "internal")
      ).toThrow("cloud metadata");
    });

    it("still blocks 169.254.x.x (link-local)", () => {
      expect(() =>
        callValidateUrl("http://169.254.1.1/mcp", "internal")
      ).toThrow("link-local");
    });
  });
});
