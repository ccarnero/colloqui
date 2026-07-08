import { describe, expect, it } from "bun:test";
import { validateUrl } from "../../src/activities/mcp-call.activity";

/**
 * Covers the SSRF guard in `mcp-call.activity.ts`'s `validateUrl`, extended
 * with an explicit `scope` parameter (mcp-connections.md SSRF-scope
 * follow-up). `scope: "internal"` is an admin opt-in that relaxes the
 * localhost/RFC1918 checks; cloud-metadata and link-local targets stay
 * blocked regardless of scope.
 */
describe("validateUrl (mcp-call.activity.ts) — SSRF guard scope semantics", () => {
  describe("external scope (default) — unchanged regression behavior", () => {
    it("accepts a public https URL", () => {
      expect(() => validateUrl("https://api.example.com/mcp")).not.toThrow();
    });

    it("rejects localhost", () => {
      expect(() => validateUrl("http://localhost:3000/mcp")).toThrow(
        "must not target localhost"
      );
    });

    it("rejects 127.0.0.1", () => {
      expect(() => validateUrl("http://127.0.0.1:3000/mcp")).toThrow(
        "must not target localhost"
      );
    });

    it("rejects 10.x.x.x (RFC1918 private)", () => {
      expect(() => validateUrl("http://10.0.0.5/mcp")).toThrow(
        "private/RFC1918"
      );
    });

    it("rejects 192.168.x.x (RFC1918 private)", () => {
      expect(() => validateUrl("http://192.168.1.10/mcp")).toThrow(
        "private/RFC1918"
      );
    });

    it("rejects 169.254.169.254 (cloud metadata)", () => {
      expect(() =>
        validateUrl("http://169.254.169.254/latest/meta-data")
      ).toThrow("cloud metadata");
    });

    it("rejects 169.254.x.x (link-local)", () => {
      expect(() => validateUrl("http://169.254.1.1/mcp")).toThrow("link-local");
    });

    it("rejects non-http(s) protocols", () => {
      expect(() => validateUrl("ftp://files.example.com/mcp")).toThrow(
        "http or https protocol"
      );
    });

    it("behaves the same when scope is explicitly 'external'", () => {
      expect(() => validateUrl("http://10.0.0.5/mcp", "external")).toThrow(
        "private/RFC1918"
      );
    });
  });

  describe("internal scope — explicit opt-in relaxation", () => {
    it("allows 10.x.x.x", () => {
      expect(() =>
        validateUrl("http://10.0.0.5/mcp", "internal")
      ).not.toThrow();
    });

    it("allows 192.168.x.x", () => {
      expect(() =>
        validateUrl("http://192.168.1.10/mcp", "internal")
      ).not.toThrow();
    });

    it("allows localhost", () => {
      expect(() =>
        validateUrl("http://localhost:3000/mcp", "internal")
      ).not.toThrow();
    });

    it("still blocks 169.254.169.254 (cloud metadata)", () => {
      expect(() =>
        validateUrl("http://169.254.169.254/latest/meta-data", "internal")
      ).toThrow("cloud metadata");
    });

    it("still blocks 169.254.x.x / fe80: (link-local)", () => {
      expect(() => validateUrl("http://169.254.1.1/mcp", "internal")).toThrow(
        "link-local"
      );
    });

    it("still blocks non-http(s) protocols", () => {
      expect(() =>
        validateUrl("ftp://files.example.com/mcp", "internal")
      ).toThrow("http or https protocol");
    });
  });
});
