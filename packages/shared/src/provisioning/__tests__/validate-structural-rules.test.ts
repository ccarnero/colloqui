import { describe, expect, test } from "bun:test";
import { validateManifestStructuralRules } from "../validate-structural-rules";
import { buildValidManifest } from "./fixtures";

describe("validateManifestStructuralRules — valid manifest", () => {
  test("returns no violations for the approved-shape fixture", () => {
    expect(validateManifestStructuralRules(buildValidManifest())).toEqual([]);
  });
});

describe("structural rule — at least one inbound channel", () => {
  test("flags a manifest whose only channel is outbound", () => {
    const manifest = buildValidManifest();
    manifest.spec.channels = [
      { ...manifest.spec.channels[0], direction: "outbound" },
    ];
    const errors = validateManifestStructuralRules(manifest);
    expect(
      errors.some(
        (e) => e.path === "spec.channels" && /inbound/.test(e.message)
      )
    ).toBe(true);
  });

  test("flags a manifest with zero channels", () => {
    const manifest = buildValidManifest();
    manifest.spec.channels = [];
    const errors = validateManifestStructuralRules(manifest);
    expect(errors.some((e) => e.path === "spec.channels")).toBe(true);
  });
});

describe("structural rule — at least one process (agent or workflow)", () => {
  test("flags a manifest with no agents and no workflows", () => {
    const manifest = buildValidManifest();
    manifest.spec.agents = [];
    manifest.spec.workflows = [];
    const errors = validateManifestStructuralRules(manifest);
    expect(
      errors.some((e) => e.path === "spec" && /process/.test(e.message))
    ).toBe(true);
  });

  test("passes with only a workflow declared", () => {
    const manifest = buildValidManifest();
    manifest.spec.agents = [];
    const errors = validateManifestStructuralRules(manifest);
    expect(errors.some((e) => /process/.test(e.message))).toBe(false);
  });
});

describe("structural rule — unique names per section", () => {
  test("flags a duplicate channel name", () => {
    const manifest = buildValidManifest();
    manifest.spec.channels = [
      manifest.spec.channels[0],
      { ...manifest.spec.channels[0] },
    ];
    const errors = validateManifestStructuralRules(manifest);
    expect(
      errors.some(
        (e) =>
          e.path === "spec.channels[1].name" && /duplicate name/.test(e.message)
      )
    ).toBe(true);
  });

  test("flags a duplicate secret name", () => {
    const manifest = buildValidManifest();
    manifest.spec.secrets = [
      manifest.spec.secrets[0],
      { ...manifest.spec.secrets[0] },
    ];
    const errors = validateManifestStructuralRules(manifest);
    expect(
      errors.some(
        (e) =>
          e.path === "spec.secrets[1].name" && /duplicate name/.test(e.message)
      )
    ).toBe(true);
  });
});

describe("structural rule — ref resolution", () => {
  test("flags an unresolved channelRef inside a workflow definition", () => {
    const manifest = buildValidManifest();
    manifest.spec.workflows[0].definition = {
      steps: [{ type: "channelSend", channelRef: "does-not-exist" }],
    };
    const errors = validateManifestStructuralRules(manifest);
    expect(
      errors.some((e) =>
        /unresolved channelRef "does-not-exist"/.test(e.message)
      )
    ).toBe(true);
  });

  test("flags an unresolved agentRef inside a workflow definition", () => {
    const manifest = buildValidManifest();
    manifest.spec.workflows[0].definition = {
      steps: [{ type: "agentCall", agentRef: "no-such-agent" }],
    };
    const errors = validateManifestStructuralRules(manifest);
    expect(
      errors.some((e) => /unresolved agentRef "no-such-agent"/.test(e.message))
    ).toBe(true);
  });

  test("flags an unresolved serviceRef inside a workflow definition", () => {
    const manifest = buildValidManifest();
    manifest.spec.workflows[0].definition = {
      steps: [{ type: "serviceCall", serviceRef: "no-such-service" }],
    };
    const errors = validateManifestStructuralRules(manifest);
    expect(
      errors.some((e) =>
        /unresolved serviceRef "no-such-service"/.test(e.message)
      )
    ).toBe(true);
  });

  test("flags an unresolved secretRef inside a workflow definition", () => {
    const manifest = buildValidManifest();
    manifest.spec.workflows[0].definition = {
      steps: [{ type: "secretFetch", secretRef: "no-such-secret" }],
    };
    const errors = validateManifestStructuralRules(manifest);
    expect(
      errors.some((e) =>
        /unresolved secretRef "no-such-secret"/.test(e.message)
      )
    ).toBe(true);
  });

  test("flags an unresolved secretRef on a channel", () => {
    const manifest = buildValidManifest();
    manifest.spec.channels[0] = {
      ...manifest.spec.channels[0],
      secretRef: "missing-secret",
    };
    const errors = validateManifestStructuralRules(manifest);
    expect(
      errors.some(
        (e) =>
          e.path === "spec.channels[0].secretRef" &&
          /unresolved secretRef "missing-secret"/.test(e.message)
      )
    ).toBe(true);
  });

  test("flags an unresolved knowledgeBaseRef on an agent", () => {
    const manifest = buildValidManifest();
    manifest.spec.agents[0] = {
      ...manifest.spec.agents[0],
      knowledgeBaseRefs: ["no-such-kb"],
    };
    const errors = validateManifestStructuralRules(manifest);
    expect(
      errors.some((e) =>
        /unresolved knowledgeBaseRef "no-such-kb"/.test(e.message)
      )
    ).toBe(true);
  });

  test("flags a secretRef scope binding that does not match the referencing resource", () => {
    const manifest = buildValidManifest();
    // The channel's secretRef points at a real secret, but that secret's
    // scope is bound to a different channel name.
    manifest.spec.secrets = manifest.spec.secrets.map((secret) =>
      secret.name === "tg-bot-token"
        ? {
            ...secret,
            scope: { kind: "channel" as const, owner: "some-other-channel" },
          }
        : secret
    );
    const errors = validateManifestStructuralRules(manifest);
    expect(
      errors.some(
        (e) =>
          e.path === "spec.channels[0].secretRef" &&
          /scope binding/.test(e.message)
      )
    ).toBe(true);
  });

  test("does not check scope binding for a secret marked external", () => {
    const manifest = buildValidManifest();
    manifest.spec.secrets = manifest.spec.secrets.map((secret) =>
      secret.name === "tg-bot-token"
        ? {
            ...secret,
            external: true,
            scope: { kind: "channel" as const, owner: "some-other-channel" },
          }
        : secret
    );
    const errors = validateManifestStructuralRules(manifest);
    expect(errors.some((e) => /scope binding/.test(e.message))).toBe(false);
  });
});
