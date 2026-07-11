import { describe, expect, it } from "vitest";
import { businessFnGroup } from "../business-fn-group";

describe("businessFnGroup", () => {
  it("groups ingress and channel-* into channel", () => {
    expect(businessFnGroup("ingress")).toBe("channel");
    expect(businessFnGroup("channel-processing")).toBe("channel");
    expect(businessFnGroup("channel-egress")).toBe("channel");
  });

  it("groups workflow-*, connector-* and routing into platform", () => {
    expect(businessFnGroup("workflow-execution")).toBe("platform");
    expect(businessFnGroup("connector-invocation")).toBe("platform");
    expect(businessFnGroup("routing")).toBe("platform");
  });

  it("groups agent-* into agent", () => {
    expect(businessFnGroup("agent-execution")).toBe("agent");
    expect(businessFnGroup("agent-admin")).toBe("agent");
    expect(businessFnGroup("agent-memory")).toBe("agent");
  });

  it("falls back to other for unmatched families", () => {
    expect(businessFnGroup("audit")).toBe("other");
    expect(businessFnGroup("dlq")).toBe("other");
    expect(businessFnGroup("runtime-presence")).toBe("other");
    expect(businessFnGroup("registry-sync")).toBe("other");
    expect(businessFnGroup("unknown")).toBe("other");
  });
});
