import { describe, expect, it } from "bun:test";
import { substituteSymbolicRefs } from "../../../src/modules/apply/lib/substitute-symbolic-refs";

describe("substituteSymbolicRefs — T03 manifest-time real-ID substitution", () => {
  it("substitutes accountId when its value is { channelRef } and resolvable", () => {
    const value = {
      actions: [
        {
          activity: "channelSend",
          args: { accountId: { channelRef: "support-telegram" }, to: "x" },
        },
      ],
    };
    const result = substituteSymbolicRefs({
      value,
      owningResourceKind: "workflow",
      owningResourceName: "wf-1",
      resolveRef: (refType, name) =>
        refType === "channelRef" && name === "support-telegram"
          ? "channel-real-id-1"
          : undefined,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        (result.value as { actions: { args: { accountId: unknown } }[] })
          .actions[0]?.args.accountId
      ).toBe("channel-real-id-1");
    }
  });

  it("substitutes adapterId when its value is { connectorRef } and resolvable", () => {
    const value = {
      actions: [
        {
          activity: "endpointCall",
          args: {
            adapterId: { connectorRef: "hubspot" },
            method: "GET",
            url: "/x",
          },
        },
      ],
    };
    const result = substituteSymbolicRefs({
      value,
      owningResourceKind: "workflow",
      owningResourceName: "wf-1",
      resolveRef: (refType, name) =>
        refType === "connectorRef" && name === "hubspot"
          ? "connector-real-id-1"
          : undefined,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        (result.value as { actions: { args: { adapterId: unknown } }[] })
          .actions[0]?.args.adapterId
      ).toBe("connector-real-id-1");
    }
  });

  it("substitutes agentId when its value is { agentRef } and resolvable", () => {
    const value = {
      actions: [
        {
          activity: "agentCall",
          args: { agentId: { agentRef: "support-agent" }, message: "hi" },
        },
      ],
    };
    const result = substituteSymbolicRefs({
      value,
      owningResourceKind: "workflow",
      owningResourceName: "wf-1",
      resolveRef: (refType, name) =>
        refType === "agentRef" && name === "support-agent"
          ? "agent-real-id-1"
          : undefined,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        (result.value as { actions: { args: { agentId: unknown } }[] })
          .actions[0]?.args.agentId
      ).toBe("agent-real-id-1");
    }
  });

  it("substitutes serviceId when its value is { serviceRef } and resolvable", () => {
    const value = {
      actions: [
        {
          activity: "serviceCall",
          args: {
            serviceId: { serviceRef: "echo-service" },
            method: "GET",
            path: "/x",
          },
        },
      ],
    };
    const result = substituteSymbolicRefs({
      value,
      owningResourceKind: "workflow",
      owningResourceName: "wf-1",
      resolveRef: (refType, name) =>
        refType === "serviceRef" && name === "echo-service"
          ? "service-real-id-1"
          : undefined,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        (result.value as { actions: { args: { serviceId: unknown } }[] })
          .actions[0]?.args.serviceId
      ).toBe("service-real-id-1");
    }
  });

  it("fails loud, naming the ref kind/name/owning resource, when a ref cannot be resolved", () => {
    const value = {
      actions: [
        {
          activity: "channelSend",
          args: { accountId: { channelRef: "missing-channel" } },
        },
      ],
    };
    const result = substituteSymbolicRefs({
      value,
      owningResourceKind: "workflow",
      owningResourceName: "wf-1",
      resolveRef: () => undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unresolved_symbolic_ref");
      expect(result.error.resourceKind).toBe("workflow");
      expect(result.error.resourceName).toBe("wf-1");
      expect(result.error.message).toContain("channelRef");
      expect(result.error.message).toContain("missing-channel");
      expect(result.error.message).toContain("wf-1");
    }
  });

  it("decision-4 ruling regression: a NON-allowlisted key with a ref-shaped value is NOT substituted", () => {
    const value = {
      // `randomField` is not in SUBSTITUTION_ALLOWLIST — even though its
      // value has the recognized ref-object shape, it must pass through
      // untouched (no structural walk of arbitrary "*Ref" keys).
      randomField: { channelRef: "support-telegram" },
    };
    const resolveRef = () => "should-never-be-used";
    const result = substituteSymbolicRefs({
      value,
      owningResourceKind: "workflow",
      owningResourceName: "wf-1",
      resolveRef,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        randomField: { channelRef: "support-telegram" },
      });
    }
  });

  it("fails loud when an allowlisted key holds a recognized ref-object of the WRONG kind, naming expected vs actual", () => {
    const value = {
      // accountId only accepts channelRef, not agentRef — a mismatched
      // symbolic ref that would never resolve; it must fail loud, not
      // silently reach the writer as a raw ref-object.
      args: { accountId: { agentRef: "support-agent" } },
    };
    const result = substituteSymbolicRefs({
      value,
      owningResourceKind: "workflow",
      owningResourceName: "wf-1",
      resolveRef: () => "should-never-be-used",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("mismatched_symbolic_ref");
      expect(result.error.resourceKind).toBe("workflow");
      expect(result.error.resourceName).toBe("wf-1");
      // Names the expected kind, the actual kind, the symbolic name, and
      // the owning resource.
      expect(result.error.message).toContain("channelRef");
      expect(result.error.message).toContain("agentRef");
      expect(result.error.message).toContain("support-agent");
      expect(result.error.message).toContain("accountId");
      expect(result.error.message).toContain("wf-1");
    }
  });

  it('runtime {{...}} template strings pass through untouched (matches the shipped telegram manifest\'s channelSend.args.accountId: "{{request.envelope.accountId}}")', () => {
    const value = {
      args: {
        // `accountId` IS an allowlisted key, but its value here is a plain
        // runtime-template STRING, not the `{ channelRef: <name> }`
        // ref-object shape — never substituted, regardless of key.
        accountId: "{{variables.workflow.accountId}}",
        message: "{{results.previous.text}}",
      },
    };
    const result = substituteSymbolicRefs({
      value,
      owningResourceKind: "workflow",
      owningResourceName: "wf-1",
      resolveRef: () => "should-never-be-used",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(value);
    }
  });

  it("never mutates the input value — returns a fresh working copy", () => {
    const value = {
      args: { accountId: { channelRef: "support-telegram" } },
    };
    const original = JSON.parse(JSON.stringify(value));
    const result = substituteSymbolicRefs({
      value,
      owningResourceKind: "workflow",
      owningResourceName: "wf-1",
      resolveRef: () => "channel-real-id-1",
    });
    expect(result.ok).toBe(true);
    expect(value).toEqual(original);
  });
});
