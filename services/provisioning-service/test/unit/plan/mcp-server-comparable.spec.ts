import "../../setup-env";
import { describe, expect, it } from "bun:test";
import {
  type McpServerDto,
  mcpServerComparable,
} from "../../../src/modules/plan/lib/comparable-fields";

// T06 (manual-loops/provisioning-manifest-gaps.md, gap 6) — mirrors the
// systemVariable/connector comparable safety tests: no credential-bearing
// field is ever readable from `McpServerDto`, let alone projected.

describe("mcpServerComparable", () => {
  it("projects transport_type/url/enabled on both sides", () => {
    const live: McpServerDto = {
      id: "mcp-1",
      name: "github-mcp",
      transport_type: "http",
      url: "https://mcp.example.com",
      enabled: true,
    };

    expect(mcpServerComparable.fromLive(live)).toEqual({
      transport_type: "http",
      url: "https://mcp.example.com",
      enabled: true,
    });

    expect(
      mcpServerComparable.fromManifest({
        name: "github-mcp",
        transport_type: "http",
        url: "https://mcp.example.com",
        enabled: true,
      })
    ).toEqual({
      transport_type: "http",
      url: "https://mcp.example.com",
      enabled: true,
    });
  });

  it("defaults `enabled` to true on the manifest side when omitted (matches the server-side default)", () => {
    expect(
      mcpServerComparable.fromManifest({
        name: "github-mcp",
        transport_type: "http",
        url: "https://mcp.example.com",
      })
    ).toEqual({
      transport_type: "http",
      url: "https://mcp.example.com",
      enabled: true,
    });
  });

  it("never projects auth/headers — McpServerDto does not even carry those fields", () => {
    const live: McpServerDto = {
      id: "mcp-1",
      name: "github-mcp",
      transport_type: "http",
      url: "https://mcp.example.com",
      enabled: true,
    };

    const projection = mcpServerComparable.fromLive(live);
    expect(Object.keys(projection)).not.toContain("auth");
    expect(Object.keys(projection)).not.toContain("headers");
    expect(Object.keys(projection)).not.toContain("authType");
    expect(Object.keys(projection)).not.toContain("authConfig");
  });

  it("the manifest-side projection never leaks a secretRef or resolved credential value", () => {
    const projection = mcpServerComparable.fromManifest({
      name: "github-mcp",
      transport_type: "http",
      url: "https://mcp.example.com",
      auth: { authType: "bearer", token: { secretRef: "github-token" } },
      headers: { "X-Custom": { secretRef: "custom-secret" } },
    });

    expect(JSON.stringify(projection)).not.toContain("github-token");
    expect(JSON.stringify(projection)).not.toContain("custom-secret");
    expect(projection).toEqual({
      transport_type: "http",
      url: "https://mcp.example.com",
      enabled: true,
    });
  });
});
