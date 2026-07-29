import { describe, expect, it } from "vitest";
import {
  type IDeepLinkableEvent,
  resolveEntityDeepLink,
} from "../resolve-entity-deep-link";

function event(overrides: Partial<IDeepLinkableEvent>): IDeepLinkableEvent {
  return { type: null, resource: null, payload: null, ...overrides };
}

describe("resolveEntityDeepLink", () => {
  it("maps connector.endpoint_call.completed.v1 + resource adapter/<id> to the connector detail route", () => {
    const result = resolveEntityDeepLink(
      event({
        type: "connector.endpoint_call.completed.v1",
        resource: "adapter/adapter-42",
      })
    );
    expect(result).toEqual({
      route: ["/connections/http", "adapter-42"],
      label: "Open connector",
    });
  });

  it("returns null for a connector event with an empty adapter id", () => {
    const result = resolveEntityDeepLink(
      event({
        type: "connector.endpoint_call.completed.v1",
        resource: "adapter/",
      })
    );
    expect(result).toBeNull();
  });

  it("returns null for a connector-typed event whose resource is not adapter/<id>-shaped", () => {
    const result = resolveEntityDeepLink(
      event({
        type: "connector.endpoint_call.completed.v1",
        resource: "endpoint/some-id",
      })
    );
    expect(result).toBeNull();
  });

  it.each([
    "io.yoizen.platform.runtime.execution_started.v1",
    "io.yoizen.platform.runtime.execution_completed.v1",
    "io.yoizen.platform.runtime.execution_failed.v1",
  ])("maps agent execution event %s + payload.agentId to the agent detail route", (type) => {
    const result = resolveEntityDeepLink(
      event({ type, payload: { agentId: "agent-7" } })
    );
    expect(result).toEqual({
      route: ["/ai/agents", "agent-7"],
      label: "Open agent",
    });
  });

  it("returns null for an agent execution event with no agentId in the payload", () => {
    const result = resolveEntityDeepLink(
      event({
        type: "io.yoizen.platform.runtime.execution_completed.v1",
        payload: { executionId: "exec-1" },
      })
    );
    expect(result).toBeNull();
  });

  it("returns null for MCP call events (no real tracked-event type exists yet)", () => {
    // mcp-call.activity.ts never publishes an EventEnvelope to NATS — there
    // is no discoverable MCP tracked-event type to match on (T05 grounding
    // finding). Any type string here is necessarily unmapped.
    const result = resolveEntityDeepLink(
      event({ type: "mcp.call.completed.v1", resource: "mcp/server-1" })
    );
    expect(result).toBeNull();
  });

  // T11 of manual-loops/connectors/connection-call-inspector.md (SPEC
  // decision 4): supersedes the old "hosted serviceCall events are never
  // mapped" assertion below — T01 of the same loop shipped a real
  // `connector.endpoint_call.completed.v1` + `resource: service/<name>`
  // event for hosted service calls, and this task added the detail route.
  it("maps connector.endpoint_call.completed.v1 + resource service/<name> to the hosted service detail route", () => {
    const result = resolveEntityDeepLink(
      event({
        type: "connector.endpoint_call.completed.v1",
        resource: "service/echo-service",
      })
    );
    expect(result).toEqual({
      route: ["/connections/hosted-services", "echo-service"],
      label: "Open hosted service",
    });
  });

  it("returns null for a service event with an empty service name", () => {
    const result = resolveEntityDeepLink(
      event({
        type: "connector.endpoint_call.completed.v1",
        resource: "service/",
      })
    );
    expect(result).toBeNull();
  });

  it("returns null for an unrecognized event type", () => {
    const result = resolveEntityDeepLink(
      event({ type: "some.other.event.v1", resource: "thing/1" })
    );
    expect(result).toBeNull();
  });

  it("returns null when type is null", () => {
    const result = resolveEntityDeepLink(event({}));
    expect(result).toBeNull();
  });
});
