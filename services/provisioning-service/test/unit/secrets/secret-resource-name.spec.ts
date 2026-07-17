import "../../setup-env";
import { describe, expect, it } from "bun:test";
import { secretResourceName } from "../../../src/modules/secrets/lib/secret-resource-name";

describe("secretResourceName", () => {
  it("builds 'psec-<kind>-<owner>' deterministically", () => {
    expect(secretResourceName("connector", "hubspot")).toBe(
      "psec-connector-hubspot"
    );
    expect(secretResourceName("channel", "http-in")).toBe(
      "psec-channel-http-in"
    );
    expect(secretResourceName("agent", "support-agent")).toBe(
      "psec-agent-support-agent"
    );
    expect(secretResourceName("service", "priority-scorer")).toBe(
      "psec-service-priority-scorer"
    );
    expect(secretResourceName("workflow", "ticket-router")).toBe(
      "psec-workflow-ticket-router"
    );
  });

  it("lowercases the camelCase mcpServer kind to a valid RFC 1123 name (T07)", () => {
    // Regression: k8s metadata.name must be an RFC 1123 subdomain
    // (lowercase); `psec-mcpServer-<owner>` was rejected with a 422 before
    // the kind token was lowercased.
    expect(secretResourceName("mcpServer", "sample-mcp-server")).toBe(
      "psec-mcpserver-sample-mcp-server"
    );
  });

  it("is a pure function — same inputs always produce the same name", () => {
    const a = secretResourceName("connector", "hubspot");
    const b = secretResourceName("connector", "hubspot");
    expect(a).toBe(b);
  });
});
