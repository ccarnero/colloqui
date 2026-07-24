import { describe, expect, it } from "bun:test";
import { disambiguateMcpToolKey } from "../../src/modules/tools/disambiguate-mcp-tool-key";

describe("disambiguateMcpToolKey", () => {
  it("returns the sanitized key unchanged when there is no collision", () => {
    const key = disambiguateMcpToolKey("srv__tool", new Set(), "srv__tool");
    expect(key).toBe("srv__tool");
  });

  it("appends a deterministic 6-hex-char suffix when the sanitized key already exists", () => {
    const existing = new Set(["srv__tool"]);
    const key = disambiguateMcpToolKey("srv__tool", existing, "srv__tool");
    expect(key).not.toBe("srv__tool");
    expect(key).toMatch(/^srv__tool__[0-9a-f]{6}$/);
  });

  it("is deterministic — the same addressing key always yields the same disambiguated key", () => {
    const existing = new Set(["srv__tool"]);
    const key1 = disambiguateMcpToolKey("srv__tool", existing, "srv__tool");
    const key2 = disambiguateMcpToolKey("srv__tool", existing, "srv__tool");
    expect(key1).toBe(key2);
  });

  it("produces different suffixes for two distinct addressing pairs that sanitize to the same string", () => {
    // e.g. "srv.a"+"tool" and "srv a"+"tool" both sanitize to "srva__tool"
    // once punctuation strips — the RAW (pre-sanitization) addressing pair
    // (not the sanitized string) is what must differentiate the suffix.
    const existing = new Set(["srva__tool"]);
    const key = disambiguateMcpToolKey("srva__tool", existing, "srv a__tool");
    expect(key).toMatch(/^srva__tool__[0-9a-f]{6}$/);
    expect(key).not.toBe("srva__tool");
  });

  it("keeps the disambiguated key within the OpenAI tool-name pattern", () => {
    const existing = new Set(["srv__tool"]);
    const key = disambiguateMcpToolKey("srv__tool", existing, "srv__tool");
    expect(key).toMatch(/^[a-zA-Z0-9_-]+$/);
  });
});
