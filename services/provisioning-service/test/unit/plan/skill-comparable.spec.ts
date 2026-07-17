import "../../setup-env";
import { describe, expect, it } from "bun:test";
import {
  type SkillDto,
  skillComparable,
} from "../../../src/modules/plan/lib/comparable-fields";

// T01 (manual-loops/provisioning-manifest-gaps-3.md, workstream a) — mirrors
// the mcpServer/systemVariable comparable safety tests: no credential-
// bearing field is ever readable from `SkillDto`, let alone projected.

describe("skillComparable", () => {
  it("projects every faithfully-comparable field on both sides", () => {
    const live: SkillDto = {
      id: "skill-1",
      name: "refund-policy-expert",
      description: "Handles refund policy questions",
      system_prompt: "You explain refund policy.",
      icon: "policy",
      color: "#00acc1",
      trigger_commands: ["/refund"],
      when_to_use: "When the customer asks about refunds",
      priority: 10,
      allowed_tools: ["search_kb"],
      mode: "router",
      files: [
        {
          name: "policy.md",
          path: "docs/policy.md",
          type: "reference",
          content: "...",
        },
      ],
    };

    const expected = {
      description: "Handles refund policy questions",
      system_prompt: "You explain refund policy.",
      icon: "policy",
      color: "#00acc1",
      trigger_commands: ["/refund"],
      when_to_use: "When the customer asks about refunds",
      priority: 10,
      allowed_tools: ["search_kb"],
      mode: "router",
      files: [
        {
          name: "policy.md",
          path: "docs/policy.md",
          type: "reference",
          content: "...",
        },
      ],
    };

    expect(skillComparable.fromLive(live)).toEqual(expected);
    expect(
      skillComparable.fromManifest({
        name: "refund-policy-expert",
        description: "Handles refund policy questions",
        system_prompt: "You explain refund policy.",
        icon: "policy",
        color: "#00acc1",
        trigger_commands: ["/refund"],
        when_to_use: "When the customer asks about refunds",
        priority: 10,
        allowed_tools: ["search_kb"],
        mode: "router",
        files: [
          {
            name: "policy.md",
            path: "docs/policy.md",
            type: "reference",
            content: "...",
          },
        ],
      })
    ).toEqual(expected);
  });

  it("defaults every optional field on the manifest side to match the server-side create() defaults", () => {
    expect(
      skillComparable.fromManifest({
        name: "refund-policy-expert",
        system_prompt: "You explain refund policy.",
      })
    ).toEqual({
      description: "",
      system_prompt: "You explain refund policy.",
      icon: "smart_toy",
      color: "#42a5f5",
      trigger_commands: [],
      when_to_use: "",
      priority: 0,
      allowed_tools: [],
      mode: "llm_driven",
      files: [],
    });
  });

  it("never leaks a credential — SkillDto/skillSchema carry no auth/token/key/secret field to even read", () => {
    const projection = skillComparable.fromManifest({
      name: "refund-policy-expert",
      system_prompt: "You explain refund policy.",
    });
    expect(Object.keys(projection)).not.toContain("secretRef");
    expect(Object.keys(projection)).not.toContain("auth");
  });
});
