import { describe, expect, test } from "bun:test";
import { collectSymbolicRefs } from "../collect-symbolic-refs";

describe("collectSymbolicRefs", () => {
  test("returns an empty list for a definition with no refs", () => {
    expect(
      collectSymbolicRefs(
        { steps: [{ type: "noop" }] },
        "spec.workflows[0].definition"
      )
    ).toEqual([]);
  });

  test("finds a ref at the top level", () => {
    const refs = collectSymbolicRefs(
      { channelRef: "support-telegram" },
      "spec.workflows[0].definition"
    );
    expect(refs).toEqual([
      {
        refType: "channelRef",
        value: "support-telegram",
        path: "spec.workflows[0].definition.channelRef",
      },
    ]);
  });

  test("finds refs nested inside arrays and objects at any depth", () => {
    const definition = {
      steps: [
        { type: "channelSend", channelRef: "support-telegram" },
        {
          type: "branch",
          branches: [{ agentCall: { agentRef: "support-agent" } }],
        },
      ],
    };
    const refs = collectSymbolicRefs(
      definition,
      "spec.workflows[0].definition"
    );
    expect(refs).toEqual([
      {
        refType: "channelRef",
        value: "support-telegram",
        path: "spec.workflows[0].definition.steps[0].channelRef",
      },
      {
        refType: "agentRef",
        value: "support-agent",
        path: "spec.workflows[0].definition.steps[1].branches[0].agentCall.agentRef",
      },
    ]);
  });

  test("collects all five ref types", () => {
    const definition = {
      channelRef: "c",
      agentRef: "a",
      serviceRef: "s",
      secretRef: "sec",
      // manual-loops/provisioning-manifest-gaps.md T03, gap 3.
      connectorRef: "conn",
    };
    const refs = collectSymbolicRefs(definition, "root");
    expect(refs.map((r) => r.refType).sort()).toEqual([
      "agentRef",
      "channelRef",
      "connectorRef",
      "secretRef",
      "serviceRef",
    ]);
  });

  test("ignores non-string values under a ref key", () => {
    const refs = collectSymbolicRefs({ channelRef: 42 }, "root");
    expect(refs).toEqual([]);
  });

  test("handles null and primitive values without throwing", () => {
    expect(collectSymbolicRefs(null, "root")).toEqual([]);
    expect(collectSymbolicRefs("just a string", "root")).toEqual([]);
    expect(collectSymbolicRefs(42, "root")).toEqual([]);
  });
});
