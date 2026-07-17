import { describe, expect, it, mock } from "bun:test";
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

  it("substitutes serverId when its value is { mcpServerRef } and resolvable (T06, gap 6)", () => {
    const value = {
      actions: [
        {
          activity: "mcpCall",
          args: {
            serverId: { mcpServerRef: "github-mcp" },
            toolName: "search_issues",
          },
        },
      ],
    };
    const result = substituteSymbolicRefs({
      value,
      owningResourceKind: "workflow",
      owningResourceName: "wf-1",
      resolveRef: (refType, name) =>
        refType === "mcpServerRef" && name === "github-mcp"
          ? "mcp-server-real-id-1"
          : undefined,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        (result.value as { actions: { args: { serverId: unknown } }[] })
          .actions[0]?.args.serverId
      ).toBe("mcp-server-real-id-1");
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

  // manual-loops/provisioning-manifest-gaps-3.md T02, workstream a.
  it("substitutes catalog_skill_id when its value is { skillRef } and resolvable, nested inside profile.model_config.subagents[]", () => {
    const value = {
      model_config: {
        subagents: [
          {
            name: "refund-helper",
            catalog_skill_id: { skillRef: "refund-policy-expert" },
          },
        ],
      },
    };
    const result = substituteSymbolicRefs({
      value,
      owningResourceKind: "agent",
      owningResourceName: "support-agent",
      resolveRef: (refType, name) =>
        refType === "skillRef" && name === "refund-policy-expert"
          ? "skill-real-id-1"
          : undefined,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        (
          result.value as {
            model_config: { subagents: { catalog_skill_id: unknown }[] };
          }
        ).model_config.subagents[0]?.catalog_skill_id
      ).toBe("skill-real-id-1");
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

  it("decision-4 ruling regression: a NON-allowlisted key with a ref-shaped value is NEVER structurally substituted (resolveRef never called)", () => {
    const value = {
      // `randomField` is not in SUBSTITUTION_ALLOWLIST — even though its
      // value has the recognized ref-object shape, `resolveRef` must never
      // be called for it (no structural walk of arbitrary "*Ref" keys). Per
      // T02's decision-5 FAIL-LOUD ruling this is now an error, not a
      // silent passthrough — see the "T02" describe block below for the
      // full fail-loud coverage.
      randomField: { channelRef: "support-telegram" },
    };
    const resolveRef = mock(() => "should-never-be-used");
    const result = substituteSymbolicRefs({
      value,
      owningResourceKind: "workflow",
      owningResourceName: "wf-1",
      resolveRef,
    });
    expect(result.ok).toBe(false);
    expect(resolveRef).not.toHaveBeenCalled();
  });

  // manual-loops/provisioning-manifest-gaps-3.md T02, workstream a.
  it("fails loud with unresolved_symbolic_ref when catalog_skill_id's skillRef cannot be resolved", () => {
    const value = {
      model_config: {
        subagents: [{ catalog_skill_id: { skillRef: "missing-skill" } }],
      },
    };
    const result = substituteSymbolicRefs({
      value,
      owningResourceKind: "agent",
      owningResourceName: "support-agent",
      resolveRef: () => undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unresolved_symbolic_ref");
      expect(result.error.message).toContain("skillRef");
      expect(result.error.message).toContain("missing-skill");
      expect(result.error.message).toContain("support-agent");
    }
  });

  it("fails loud with mismatched_symbolic_ref when catalog_skill_id holds the WRONG ref kind", () => {
    const value = {
      model_config: {
        subagents: [{ catalog_skill_id: { agentRef: "support-agent" } }],
      },
    };
    const result = substituteSymbolicRefs({
      value,
      owningResourceKind: "agent",
      owningResourceName: "support-agent",
      resolveRef: () => "should-never-be-used",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("mismatched_symbolic_ref");
      expect(result.error.message).toContain("skillRef");
      expect(result.error.message).toContain("agentRef");
      expect(result.error.message).toContain("catalog_skill_id");
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

// manual-loops/provisioning-manifest-gaps-3.md T03, workstream d — ARRAY
// symbolic-ref substitution (`ARRAY_SUBSTITUTION_ALLOWLIST`, one entry:
// `accountIds` -> `channelRef`).
describe("substituteSymbolicRefs — T03 ARRAY symbolic-ref substitution (accountIds -> channelRef)", () => {
  it("array happy path: every element is a recognized ref-object and resolves", () => {
    const value = {
      trigger: {
        type: "message_received",
        config: {
          accountIds: [
            { channelRef: "telegram-transform-reply-bot" },
            { channelRef: "http-fanout-telegram-account" },
          ],
        },
      },
    };
    const resolveRef = (refType: string, name: string): string | undefined => {
      const table: Record<string, string> = {
        "channelRef:telegram-transform-reply-bot": "channel-real-id-1",
        "channelRef:http-fanout-telegram-account": "channel-real-id-2",
      };
      return table[`${refType}:${name}`];
    };
    const result = substituteSymbolicRefs({
      value,
      owningResourceKind: "workflow",
      owningResourceName: "wf-1",
      resolveRef,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        (
          result.value as {
            trigger: { config: { accountIds: unknown[] } };
          }
        ).trigger.config.accountIds
      ).toEqual(["channel-real-id-1", "channel-real-id-2"]);
    }
  });

  it("mixed array: literal id strings pass through untouched alongside resolved ref-object elements", () => {
    const value = {
      trigger: {
        config: {
          accountIds: [
            "already-real-channel-id",
            { channelRef: "telegram-transform-reply-bot" },
            "{{variables.system.some-channel-id}}",
          ],
        },
      },
    };
    const result = substituteSymbolicRefs({
      value,
      owningResourceKind: "workflow",
      owningResourceName: "wf-1",
      resolveRef: (refType, name) =>
        refType === "channelRef" && name === "telegram-transform-reply-bot"
          ? "channel-real-id-1"
          : undefined,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        (
          result.value as {
            trigger: { config: { accountIds: unknown[] } };
          }
        ).trigger.config.accountIds
      ).toEqual([
        "already-real-channel-id",
        "channel-real-id-1",
        "{{variables.system.some-channel-id}}",
      ]);
    }
  });

  it("nested position: trigger.config.accountIds resolves at its real manifest depth", () => {
    const value = {
      actions: [{ activity: "jsFunction", args: { code: "..." } }],
      trigger: {
        type: "message_received",
        mode: "shared",
        config: {
          channels: ["telegram"],
          accountIds: [{ channelRef: "telegram-transform-reply-bot" }],
        },
      },
    };
    const result = substituteSymbolicRefs({
      value,
      owningResourceKind: "workflow",
      owningResourceName: "telegram-transform-reply",
      resolveRef: () => "channel-real-id-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        (
          result.value as {
            trigger: { config: { accountIds: unknown[] } };
          }
        ).trigger.config.accountIds
      ).toEqual(["channel-real-id-1"]);
    }
  });

  it("fails loud with mismatched_symbolic_ref, naming the element index, when an array element is the WRONG ref kind", () => {
    const value = {
      trigger: { config: { accountIds: [{ agentRef: "support-agent" }] } },
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
      expect(result.error.message).toContain("channelRef");
      expect(result.error.message).toContain("agentRef");
      expect(result.error.message).toContain("accountIds");
      expect(result.error.message).toContain("trigger.config.accountIds[0]");
    }
  });

  it("fails loud with unresolved_symbolic_ref, naming the element index, when an array element cannot be resolved", () => {
    const value = {
      trigger: {
        config: {
          accountIds: [
            { channelRef: "telegram-transform-reply-bot" },
            { channelRef: "missing-channel" },
          ],
        },
      },
    };
    const result = substituteSymbolicRefs({
      value,
      owningResourceKind: "workflow",
      owningResourceName: "wf-1",
      resolveRef: (refType, name) =>
        refType === "channelRef" && name === "telegram-transform-reply-bot"
          ? "channel-real-id-1"
          : undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unresolved_symbolic_ref");
      expect(result.error.message).toContain("channelRef");
      expect(result.error.message).toContain("missing-channel");
      expect(result.error.message).toContain("trigger.config.accountIds[1]");
    }
  });

  it("fails loud with invalid_array_substitution_shape when a NON-array value sits at the array-allowlisted key", () => {
    const value = {
      trigger: { config: { accountIds: { channelRef: "single-not-array" } } },
    };
    const result = substituteSymbolicRefs({
      value,
      owningResourceKind: "workflow",
      owningResourceName: "wf-1",
      resolveRef: () => "should-never-be-used",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid_array_substitution_shape");
      expect(result.error.message).toContain("accountIds");
      expect(result.error.message).toContain("wf-1");
    }
  });

  it("empty array at the array-allowlisted key is legal and resolves to an empty array", () => {
    const value = { trigger: { config: { accountIds: [] } } };
    const result = substituteSymbolicRefs({
      value,
      owningResourceKind: "workflow",
      owningResourceName: "wf-1",
      resolveRef: () => "should-never-be-used",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        (
          result.value as {
            trigger: { config: { accountIds: unknown[] } };
          }
        ).trigger.config.accountIds
      ).toEqual([]);
    }
  });

  it("fails loud (unallowlisted_symbolic_ref) per-element for an array of ref-objects at a NON-array-allowlisted key, naming the element index", () => {
    const value = {
      trigger: {
        config: {
          // `otherIds` is not in ARRAY_SUBSTITUTION_ALLOWLIST — a stray
          // ref-object array here must still fail loud (T02 safety fix,
          // extended per-element by T03).
          otherIds: [{ channelRef: "telegram-transform-reply-bot" }],
        },
      },
    };
    const result = substituteSymbolicRefs({
      value,
      owningResourceKind: "workflow",
      owningResourceName: "wf-1",
      resolveRef: () => "should-never-be-used",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unallowlisted_symbolic_ref");
      expect(result.error.message).toContain("otherIds");
      expect(result.error.message).toContain("channelRef");
      expect(result.error.message).toContain("trigger.config.otherIds[0]");
    }
  });

  it("secretRef array exemption consistency: an array of { secretRef } at a NON-allowlisted plural key passes through untouched", () => {
    const value = {
      trigger: {
        config: {
          someSecretRefs: [
            { secretRef: "api-key-one" },
            { secretRef: "api-key-two" },
          ],
        },
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

  it("never mutates the input value for array substitution — returns a fresh working copy", () => {
    const value = {
      trigger: {
        config: {
          accountIds: [{ channelRef: "telegram-transform-reply-bot" }],
        },
      },
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

  // manual-loops/provisioning-manifest-gaps-3.md T03 accept criterion:
  // "dependency-order (channel created same-apply -> workflow trigger gets
  // fresh id)". The walker itself is order-agnostic (it just calls
  // `resolveRef`); this proves that when `resolveRef` reflects a channel
  // that WAS created earlier in the same apply (the caller's real usage
  // shape via `RESOURCE_KIND_ORDER` ranking channel before workflow), the
  // array substitution consumes that fresh id correctly.
  it("dependency-order: an accountIds ref resolves to a channel id created earlier in the same apply", () => {
    const createdThisApply = new Map<string, string>([
      ["telegram-transform-reply-bot", "channel-fresh-id-42"],
    ]);
    const value = {
      trigger: {
        config: {
          accountIds: [{ channelRef: "telegram-transform-reply-bot" }],
        },
      },
    };
    const result = substituteSymbolicRefs({
      value,
      owningResourceKind: "workflow",
      owningResourceName: "telegram-transform-reply",
      resolveRef: (refType, name) =>
        refType === "channelRef" ? createdThisApply.get(name) : undefined,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        (
          result.value as {
            trigger: { config: { accountIds: unknown[] } };
          }
        ).trigger.config.accountIds
      ).toEqual(["channel-fresh-id-42"]);
    }
  });
});

// manual-loops/provisioning-manifest-gaps-2.md T02, gap 3, decision 5 ruling
// (2026-07-16, FAIL LOUD).
describe("substituteSymbolicRefs — T02 fail-loud on ref-shaped objects at non-allowlisted keys", () => {
  it("returns unallowlisted_symbolic_ref, naming the key/kind/name/resource, for a ref-object at a non-allowlisted key", () => {
    const value = {
      // manual-loops/provisioning-manifest-gaps-2.md T03, gap 2 ADDED
      // `connectorId`/`provider_connector_id` to SUBSTITUTION_ALLOWLIST
      // (the ORIGINAL example key this T02 test used, now legitimately
      // allowlisted — see `apply-manifest.spec.ts`'s T03 gap-2 tests for its
      // NEW allowlisted behavior). `some_unrelated_field` is NOT (and never
      // has been) in SUBSTITUTION_ALLOWLIST, keeping this test's coverage of
      // the non-allowlisted-key path intact.
      some_unrelated_field: { agentRef: "hubspot" },
    };
    const result = substituteSymbolicRefs({
      value,
      owningResourceKind: "agent",
      owningResourceName: "support-agent",
      resolveRef: () => "should-never-be-used",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unallowlisted_symbolic_ref");
      expect(result.error.resourceKind).toBe("agent");
      expect(result.error.resourceName).toBe("support-agent");
      expect(result.error.message).toContain("some_unrelated_field");
      expect(result.error.message).toContain("agentRef");
      expect(result.error.message).toContain("hubspot");
      expect(result.error.message).toContain("support-agent");
    }
  });

  it("catches a ref-object nested deep inside the tree, not only at the top level", () => {
    const value = {
      actions: [
        {
          activity: "endpointCall",
          args: {
            method: "GET",
            url: "/x",
            nested: {
              deeper: {
                someOtherField: { agentRef: "support-agent" },
              },
            },
          },
        },
      ],
    };
    const result = substituteSymbolicRefs({
      value,
      owningResourceKind: "workflow",
      owningResourceName: "wf-1",
      resolveRef: () => "should-never-be-used",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unallowlisted_symbolic_ref");
      expect(result.error.message).toContain("someOtherField");
      expect(result.error.message).toContain("agentRef");
      expect(result.error.message).toContain("support-agent");
      expect(result.error.message).toContain(
        "actions[0].args.nested.deeper.someOtherField"
      );
    }
  });

  it("EXEMPTS { secretRef } at a non-allowlisted key — passes through untouched (never substituted; validated against spec.secrets + resolved at runtime)", () => {
    // Evidence for the exemption (see substitute-symbolic-refs.ts header):
    //   1. manifest.schema.ts:610-618 — the workflow schema comment states
    //      definition steps "may embed channelRef/agentRef/serviceRef/
    //      secretRef/connectorRef keys at any depth".
    //   2. validate-structural-rules.ts checkRefResolution — runs
    //      collectSymbolicRefs over every workflow.definition and has a live
    //      `case "secretRef"` validating it against spec.secrets. The
    //      structural validator is built to ACCEPT a secretRef in a
    //      definition; failing it loud here would reject a valid manifest.
    const value = {
      someField: { secretRef: "my-api-key" },
    };
    const result = substituteSymbolicRefs({
      value,
      owningResourceKind: "agent",
      owningResourceName: "support-agent",
      resolveRef: () => "should-never-be-used",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(value);
    }
  });

  it("mixed: a secretRef deep inside a definition passes through while a connectorRef at the SAME position still fails loud", () => {
    // secretRef nested deep — exempt, passes through.
    const secretValue = {
      actions: [
        { args: { nested: { deeper: { anyKey: { secretRef: "api-key" } } } } },
      ],
    };
    const secretResult = substituteSymbolicRefs({
      value: secretValue,
      owningResourceKind: "workflow",
      owningResourceName: "wf-1",
      resolveRef: () => "should-never-be-used",
    });
    expect(secretResult.ok).toBe(true);
    if (secretResult.ok) {
      expect(secretResult.value).toEqual(secretValue);
    }

    // connectorRef at the exact same non-allowlisted position — still fails.
    const connectorValue = {
      actions: [
        {
          args: {
            nested: { deeper: { anyKey: { connectorRef: "hubspot" } } },
          },
        },
      ],
    };
    const connectorResult = substituteSymbolicRefs({
      value: connectorValue,
      owningResourceKind: "workflow",
      owningResourceName: "wf-1",
      resolveRef: () => "should-never-be-used",
    });
    expect(connectorResult.ok).toBe(false);
    if (!connectorResult.ok) {
      expect(connectorResult.error.kind).toBe("unallowlisted_symbolic_ref");
      expect(connectorResult.error.message).toContain("connectorRef");
      expect(connectorResult.error.message).toContain("hubspot");
    }
  });

  it("legit plain string at a non-allowlisted key still passes through", () => {
    const value = { description: "a plain description string" };
    const result = substituteSymbolicRefs({
      value,
      owningResourceKind: "agent",
      owningResourceName: "support-agent",
      resolveRef: () => "should-never-be-used",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(value);
    }
  });

  it("legit runtime {{...}} template at a non-allowlisted key still passes through", () => {
    const value = { message: "{{results.previous.text}}" };
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

  it("legit multi-key object at a non-allowlisted key still passes through", () => {
    const value = {
      metadata: { channelRef: "support-telegram", extra: "field" },
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

  it("legit single-key object whose key is NOT a SYMBOLIC_REF_KEYS member still passes through", () => {
    const value = { config: { notARefKey: "some-name" } };
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

  // manual-loops/provisioning-manifest-gaps-2.md T02 — regression check for
  // the THREE shipped manifests (decision 1). Definitions transcribed
  // verbatim from each manifest.yaml's `workflows[].definition` (minus the
  // `code:` string bodies, which are opaque strings that never trip this
  // walker regardless of content). Every `resolveRef` returns a real id so
  // ok:true here proves the SAME definitions the writer actually receives
  // walk clean end-to-end, not just superficially.
  it("regression: integrations/channels/telegram-transform-reply/manifest.yaml's workflow definition walks clean", () => {
    const definition = {
      application: "samples",
      actions: [
        { name: "transform", activity: "jsFunction", args: { code: "..." } },
        {
          name: "reply",
          activity: "channelSend",
          args: {
            accountId: "{{request.envelope.accountId}}",
            channel: "{{request.channel}}",
            provider: "{{request.provider}}",
            to: "{{request.from}}",
            type: "text",
            text: "{{results.transform.text}}",
          },
        },
      ],
      trigger: {
        type: "message_received",
        mode: "shared",
        config: { channels: ["telegram"], providers: ["telegram"] },
      },
    };
    const result = substituteSymbolicRefs({
      value: definition,
      owningResourceKind: "workflow",
      owningResourceName: "telegram-transform-reply",
      resolveRef: () => "should-never-be-used",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(definition);
    }
  });

  it("regression: integrations/channels/http-fanout-telegram/manifest.yaml's workflow definition walks clean and substitutes its allowlisted refs", () => {
    const definition = {
      application: "samples",
      actions: [
        {
          name: "fanout",
          activity: "branch",
          jsonplaceholder: [
            {
              name: "getPost",
              activity: "endpointCall",
              args: {
                adapterId: { connectorRef: "jsonplaceholder" },
                method: "GET",
                url: "/posts/1",
              },
            },
          ],
          pokeapi: [
            {
              name: "getPokemon",
              activity: "endpointCall",
              args: {
                adapterId: { connectorRef: "pokeapi" },
                method: "GET",
                url: "/api/v2/pokemon/ditto",
              },
            },
          ],
          catfacts: [
            {
              name: "getCatFact",
              activity: "endpointCall",
              args: {
                adapterId: { connectorRef: "catfacts" },
                method: "GET",
                url: "/fact",
              },
            },
          ],
        },
        { name: "join", activity: "jsFunction", args: { code: "..." } },
        {
          name: "postToHttpbin",
          activity: "endpointCall",
          args: {
            adapterId: { connectorRef: "httpbin" },
            method: "POST",
            url: "/post",
            data: {
              source: "http-fanout-telegram",
              summary: "{{results.join.summary}}",
              payload: "{{results.join.combinedJson}}",
            },
          },
        },
        {
          name: "notify",
          activity: "channelSend",
          args: {
            accountId: { channelRef: "telegram-transform-reply-bot" },
            channel: "telegram",
            provider: "telegram",
            to: "{{variables.system.http-fanout-telegram-chat-id}}",
            type: "text",
            text: "{{results.join.summary}}\n(httpbin status: {{results.postToHttpbin.status}})",
          },
        },
      ],
      trigger: {
        type: "message_received",
        mode: "shared",
        config: { channels: ["http"], providers: ["http"] },
      },
    };
    const resolveRef = (refType: string, name: string): string | undefined => {
      const table: Record<string, string> = {
        "connectorRef:jsonplaceholder": "connector-jsonplaceholder-id",
        "connectorRef:pokeapi": "connector-pokeapi-id",
        "connectorRef:catfacts": "connector-catfacts-id",
        "connectorRef:httpbin": "connector-httpbin-id",
        "channelRef:telegram-transform-reply-bot": "channel-telegram-id",
      };
      return table[`${refType}:${name}`];
    };
    const result = substituteSymbolicRefs({
      value: definition,
      owningResourceKind: "workflow",
      owningResourceName: "http-fanout-telegram",
      resolveRef,
    });
    expect(result.ok).toBe(true);
  });

  it("regression: integrations/http/hosted-services-api/manifest.yaml's workflow definition walks clean and substitutes its allowlisted refs", () => {
    const definition = {
      application: "samples",
      actions: [
        {
          name: "invokeHosted",
          activity: "serviceCall",
          args: {
            serviceId: { serviceRef: "sample-echo" },
            serviceSlug: "sample-echo",
            method: "POST",
            path: "/anything",
            data: {
              source: "hosted-services-api",
              marker: "HOSTED SERVICE SAMPLE",
              workflowName: "hosted-service-telegram",
              serviceName: "sample-echo",
              inbound: "{{request.text}}",
            },
          },
        },
        { name: "summarize", activity: "jsFunction", args: { code: "..." } },
        {
          name: "notify",
          activity: "channelSend",
          args: {
            accountId: { channelRef: "telegram-transform-reply-bot" },
            channel: "telegram",
            provider: "telegram",
            to: "{{variables.system.hosted-services-api-chat-id}}",
            type: "text",
            text: "{{results.summarize.text}}",
          },
        },
      ],
      trigger: {
        type: "message_received",
        mode: "shared",
        config: { channels: ["http"], providers: ["http"] },
      },
    };
    const resolveRef = (refType: string, name: string): string | undefined => {
      const table: Record<string, string> = {
        "serviceRef:sample-echo": "service-sample-echo-id",
        "channelRef:telegram-transform-reply-bot": "channel-telegram-id",
      };
      return table[`${refType}:${name}`];
    };
    const result = substituteSymbolicRefs({
      value: definition,
      owningResourceKind: "workflow",
      owningResourceName: "hosted-service-telegram",
      resolveRef,
    });
    expect(result.ok).toBe(true);
  });
});
