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

// manual-loops/provisioning-manifest-gaps-2.md T01, gap 1 — `kind:
// LibraryManifest` waives the >=1-inbound-channel and >=1-process checks
// above, replaced by a >=1-real-resource check. The non-library assertions
// above are UNCHANGED (regression).
describe("structural rule — library manifests (kind: LibraryManifest)", () => {
  test("a library manifest with only connectors and zero channels/processes is valid", () => {
    const manifest = buildValidManifest();
    manifest.kind = "LibraryManifest";
    manifest.spec.channels = [];
    manifest.spec.agents = [];
    manifest.spec.workflows = [];
    manifest.spec.mcpServers = [];
    manifest.spec.knowledgeBases = [];
    manifest.spec.services = [];
    manifest.spec.systemVariables = [];
    manifest.spec.secrets = manifest.spec.secrets.filter(
      (s) => s.scope.kind === "connector"
    );
    const errors = validateManifestStructuralRules(manifest);
    expect(errors).toEqual([]);
  });

  test("a library manifest with only mcpServers and zero channels/processes is valid", () => {
    const manifest = buildValidManifest();
    manifest.kind = "LibraryManifest";
    manifest.spec.channels = [];
    manifest.spec.agents = [];
    manifest.spec.workflows = [];
    manifest.spec.connectors = [];
    manifest.spec.knowledgeBases = [];
    manifest.spec.services = [];
    manifest.spec.systemVariables = [];
    manifest.spec.secrets = manifest.spec.secrets.filter(
      (s) => s.scope.kind === "mcpServer"
    );
    const errors = validateManifestStructuralRules(manifest);
    expect(errors).toEqual([]);
  });

  test("a library manifest declaring zero resources of any kind is invalid", () => {
    const manifest = buildValidManifest();
    manifest.kind = "LibraryManifest";
    manifest.spec.channels = [];
    manifest.spec.agents = [];
    manifest.spec.workflows = [];
    manifest.spec.connectors = [];
    manifest.spec.mcpServers = [];
    manifest.spec.knowledgeBases = [];
    manifest.spec.services = [];
    manifest.spec.systemVariables = [];
    manifest.spec.secrets = [];
    const errors = validateManifestStructuralRules(manifest);
    expect(
      errors.some(
        (e) => e.path === "spec" && /library manifest/.test(e.message)
      )
    ).toBe(true);
  });

  test("regression: a NON-library manifest with zero channels is still invalid", () => {
    const manifest = buildValidManifest();
    // kind stays IntegrationManifest (default from the fixture).
    manifest.spec.channels = [];
    const errors = validateManifestStructuralRules(manifest);
    expect(errors.some((e) => e.path === "spec.channels")).toBe(true);
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

  // T06 (manual-loops/provisioning-manifest-gaps.md, gap 6)
  test("flags an unresolved mcpServerRef inside a workflow definition", () => {
    const manifest = buildValidManifest();
    manifest.spec.workflows[0].definition = {
      steps: [{ type: "mcpCall", mcpServerRef: "no-such-mcp-server" }],
    };
    const errors = validateManifestStructuralRules(manifest);
    expect(
      errors.some((e) =>
        /unresolved mcpServerRef "no-such-mcp-server"/.test(e.message)
      )
    ).toBe(true);
  });

  // manual-loops/provisioning-manifest-gaps-2.md T06, gap 1.
  test("flags an unresolved connectorRef inside a workflow definition", () => {
    const manifest = buildValidManifest();
    manifest.spec.workflows[0].definition = {
      steps: [{ type: "connectorCall", connectorRef: "no-such-connector" }],
    };
    const errors = validateManifestStructuralRules(manifest);
    expect(
      errors.some((e) =>
        /unresolved connectorRef "no-such-connector"/.test(e.message)
      )
    ).toBe(true);
  });

  test("passes with a connectorRef resolving to a declared connector", () => {
    const manifest = buildValidManifest();
    manifest.spec.workflows[0].definition = {
      steps: [{ type: "connectorCall", connectorRef: "hubspot" }],
    };
    const errors = validateManifestStructuralRules(manifest);
    expect(errors.some((e) => /connectorRef/.test(e.message))).toBe(false);
  });

  test("passes with a connectorRef resolving to an external connector", () => {
    const manifest = buildValidManifest();
    manifest.spec.connectors = [
      { ...manifest.spec.connectors[0], external: true },
    ];
    manifest.spec.workflows[0].definition = {
      steps: [{ type: "connectorCall", connectorRef: "hubspot" }],
    };
    const errors = validateManifestStructuralRules(manifest);
    expect(errors.some((e) => /connectorRef/.test(e.message))).toBe(false);
  });

  test("flags an unresolved enabledMcpServerRefs entry on an agent", () => {
    const manifest = buildValidManifest();
    manifest.spec.agents[0] = {
      ...manifest.spec.agents[0],
      enabledMcpServerRefs: ["no-such-mcp-server"],
    };
    const errors = validateManifestStructuralRules(manifest);
    expect(
      errors.some((e) =>
        /unresolved mcpServerRef "no-such-mcp-server"/.test(e.message)
      )
    ).toBe(true);
  });

  // manual-loops/provisioning-manifest-gaps-2.md T04, gap 4.
  test("flags an unresolved enabledMcpTools server-name key on an agent", () => {
    const manifest = buildValidManifest();
    manifest.spec.agents[0] = {
      ...manifest.spec.agents[0],
      enabledMcpTools: { "no-such-mcp-server": ["some_tool"] },
    };
    const errors = validateManifestStructuralRules(manifest);
    expect(
      errors.some((e) =>
        /unresolved mcpServerRef "no-such-mcp-server"/.test(e.message)
      )
    ).toBe(true);
  });

  test("accepts enabledMcpTools keyed by a declared mcpServer name", () => {
    const manifest = buildValidManifest();
    manifest.spec.agents[0] = {
      ...manifest.spec.agents[0],
      enabledMcpTools: { "support-mcp": ["some_tool"] },
    };
    const errors = validateManifestStructuralRules(manifest);
    expect(errors.some((e) => /enabledMcpTools/.test(e.path ?? ""))).toBe(
      false
    );
  });

  test("accepts enabledMcpTools keyed by an EXTERNAL mcpServer's name", () => {
    const manifest = buildValidManifest();
    manifest.spec.mcpServers[0] = {
      ...manifest.spec.mcpServers[0],
      external: true,
    };
    manifest.spec.agents[0] = {
      ...manifest.spec.agents[0],
      enabledMcpTools: { "support-mcp": null },
    };
    const errors = validateManifestStructuralRules(manifest);
    expect(errors.some((e) => /enabledMcpTools/.test(e.path ?? ""))).toBe(
      false
    );
  });

  test("flags an unresolved serverName prefix in a toolDescriptionOverrides key", () => {
    const manifest = buildValidManifest();
    manifest.spec.agents[0] = {
      ...manifest.spec.agents[0],
      toolDescriptionOverrides: {
        "no-such-mcp-server:some_tool": "override text",
      },
    };
    const errors = validateManifestStructuralRules(manifest);
    expect(
      errors.some((e) =>
        /unresolved mcpServerRef "no-such-mcp-server"/.test(e.message)
      )
    ).toBe(true);
  });

  test("accepts a plain-name toolDescriptionOverrides key (adapter/builtin tool, no colon, NOT validated against mcpServers)", () => {
    const manifest = buildValidManifest();
    manifest.spec.agents[0] = {
      ...manifest.spec.agents[0],
      toolDescriptionOverrides: { http_fetch: "Fetch a URL over HTTP." },
    };
    const errors = validateManifestStructuralRules(manifest);
    expect(
      errors.some((e) => /toolDescriptionOverrides/.test(e.path ?? ""))
    ).toBe(false);
  });

  test("flags an unresolved secretRef inside an mcpServer's auth block", () => {
    const manifest = buildValidManifest();
    manifest.spec.mcpServers[0] = {
      ...manifest.spec.mcpServers[0],
      auth: { authType: "bearer", token: { secretRef: "missing-mcp-secret" } },
    };
    const errors = validateManifestStructuralRules(manifest);
    expect(
      errors.some(
        (e) =>
          e.path === "spec.mcpServers[0].auth.token.secretRef" &&
          /unresolved secretRef "missing-mcp-secret"/.test(e.message)
      )
    ).toBe(true);
  });

  test("flags an unresolved secretRef inside an mcpServer's headers", () => {
    const manifest = buildValidManifest();
    manifest.spec.mcpServers[0] = {
      ...manifest.spec.mcpServers[0],
      headers: { "X-Custom": { secretRef: "missing-header-secret" } },
    };
    const errors = validateManifestStructuralRules(manifest);
    expect(
      errors.some(
        (e) =>
          e.path === "spec.mcpServers[0].headers.X-Custom.secretRef" &&
          /unresolved secretRef "missing-header-secret"/.test(e.message)
      )
    ).toBe(true);
  });

  // manual-loops/provisioning-manifest-gaps-2.md T05, gap 5 (HUMAN RULING
  // 2026-07-16 — PLAIN STRINGS ONLY): `env[].value` is a plain `string`, so
  // an env var can never carry a secretRef and never participates in
  // ref/scope-binding resolution — a plain string value is inert here.
  test("does not flag a plain string env value (not a secretRef at all)", () => {
    const manifest = buildValidManifest();
    manifest.spec.services[0] = {
      ...manifest.spec.services[0],
      env: [{ name: "YOIZEN_SAMPLE", value: "true" }],
    };
    const errors = validateManifestStructuralRules(manifest);
    expect(errors.some((e) => /env\[0\]/.test(e.path ?? ""))).toBe(false);
  });
});
