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

  // manual-loops/provisioning-manifest-gaps-3.md T02, workstream a — mirrors
  // the connectorRef case above, but the ref lives inside an agent's own
  // `profile` tree (skillRef never appears in a workflow definition).
  test("flags an unresolved skillRef inside an agent's profile", () => {
    const manifest = buildValidManifest();
    manifest.spec.agents[0] = {
      ...manifest.spec.agents[0],
      profile: {
        model_config: {
          subagents: [{ catalog_skill_id: { skillRef: "no-such-skill" } }],
        },
      },
    };
    const errors = validateManifestStructuralRules(manifest);
    expect(
      errors.some((e) => /unresolved skillRef "no-such-skill"/.test(e.message))
    ).toBe(true);
  });

  test("passes with a skillRef resolving to a declared skill", () => {
    const manifest = buildValidManifest();
    manifest.spec.skills = [
      { name: "refund-policy-expert", system_prompt: "Handle refunds." },
    ];
    manifest.spec.agents[0] = {
      ...manifest.spec.agents[0],
      profile: {
        model_config: {
          subagents: [
            { catalog_skill_id: { skillRef: "refund-policy-expert" } },
          ],
        },
      },
    };
    const errors = validateManifestStructuralRules(manifest);
    expect(errors.some((e) => /skillRef/.test(e.message))).toBe(false);
  });

  test("passes with a skillRef resolving to an external skill", () => {
    const manifest = buildValidManifest();
    manifest.spec.skills = [
      {
        name: "refund-policy-expert",
        system_prompt: "Handle refunds.",
        external: true,
      },
    ];
    manifest.spec.agents[0] = {
      ...manifest.spec.agents[0],
      profile: {
        model_config: {
          subagents: [
            { catalog_skill_id: { skillRef: "refund-policy-expert" } },
          ],
        },
      },
    };
    const errors = validateManifestStructuralRules(manifest);
    expect(errors.some((e) => /skillRef/.test(e.message))).toBe(false);
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

  // agent-mcp-tool-naming.md T01 (Option B, human-ruled 2026-07-24) — the
  // separator is `__` (double underscore); single global identity, no
  // legacy `:` form (T01's measured live migration surface was 0
  // colon-keyed entries on the dev tenant, so there was nothing to bridge —
  // see the SPEC's Progress log). A colon-keyed entry is no longer
  // recognized as MCP-namespaced at all (falls through to the plain-key,
  // not-validated-against-mcpServers case below).
  test("flags an unresolved serverName prefix in a '__'-separated toolDescriptionOverrides key", () => {
    const manifest = buildValidManifest();
    manifest.spec.agents[0] = {
      ...manifest.spec.agents[0],
      toolDescriptionOverrides: {
        "no-such-mcp-server__some_tool": "override text",
      },
    };
    const errors = validateManifestStructuralRules(manifest);
    expect(
      errors.some((e) =>
        /unresolved mcpServerRef "no-such-mcp-server"/.test(e.message)
      )
    ).toBe(true);
  });

  test("accepts toolDescriptionOverrides keyed with the '__' separator against a declared mcpServer name", () => {
    const manifest = buildValidManifest();
    manifest.spec.agents[0] = {
      ...manifest.spec.agents[0],
      toolDescriptionOverrides: { "support-mcp__some_tool": "override text" },
    };
    const errors = validateManifestStructuralRules(manifest);
    expect(
      errors.some((e) => /toolDescriptionOverrides/.test(e.path ?? ""))
    ).toBe(false);
  });

  test("accepts a plain-name toolDescriptionOverrides key (adapter/builtin tool, no separator, NOT validated against mcpServers)", () => {
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

  // manual-loops/provisioning-manifest-gaps-2.md T05, gap 5 (round 1, HUMAN
  // RULING 2026-07-16 — PLAIN STRINGS ONLY) restricted `env[].value` to a
  // plain `string` only. manual-loops/provisioning-manifest-gaps-4.md T01
  // (round 2, 2026-07-24) widens `value` to a 4-shape union (see
  // `manifest.schema.ts`'s `serviceEnvVarSchema` header comment) — a plain
  // string value is STILL one of the legal shapes and remains inert here
  // (carries no secretRef/connectorRef, never participates in ref/scope
  // resolution); the ref-shaped values below (added by T01) DO participate.
  test("does not flag a plain string env value (not a secretRef at all)", () => {
    const manifest = buildValidManifest();
    manifest.spec.services[0] = {
      ...manifest.spec.services[0],
      env: [{ name: "YOIZEN_SAMPLE", value: "true" }],
    };
    const errors = validateManifestStructuralRules(manifest);
    expect(errors.some((e) => /env\[0\]/.test(e.path ?? ""))).toBe(false);
  });

  // manual-loops/provisioning-manifest-gaps-4.md T01, decision 1/Option B —
  // a service env's `{ secretRef }`-shaped value is validated the SAME way
  // every other secretRef consumer is (scope `kind: "service", owner:
  // <service name>`), reusing `checkSecretRef` verbatim.
  test("flags an unresolved secretRef inside a service's env[] value", () => {
    const manifest = buildValidManifest();
    manifest.spec.services[0] = {
      ...manifest.spec.services[0],
      env: [
        { name: "API_KEY", value: { secretRef: "no-such-service-secret" } },
      ],
    };
    const errors = validateManifestStructuralRules(manifest);
    expect(
      errors.some(
        (e) =>
          e.path === "spec.services[0].env[0].value.secretRef" &&
          /unresolved secretRef "no-such-service-secret"/.test(e.message)
      )
    ).toBe(true);
  });

  test("passes with a service env secretRef resolving to a declared, correctly-scoped secret", () => {
    const manifest = buildValidManifest();
    manifest.spec.services[0] = {
      ...manifest.spec.services[0],
      env: [{ name: "API_KEY", value: { secretRef: "scorer-api-key" } }],
    };
    const errors = validateManifestStructuralRules(manifest);
    expect(errors.some((e) => /env\[0\]/.test(e.path ?? ""))).toBe(false);
  });

  test("flags a service env secretRef whose scope binding does not match the referencing service", () => {
    const manifest = buildValidManifest();
    // `hubspot-api-key` is bound to the connector "hubspot", not any service.
    manifest.spec.services[0] = {
      ...manifest.spec.services[0],
      env: [{ name: "API_KEY", value: { secretRef: "hubspot-api-key" } }],
    };
    const errors = validateManifestStructuralRules(manifest);
    expect(
      errors.some(
        (e) =>
          e.path === "spec.services[0].env[0].value.secretRef" &&
          /does not match the referencing resource/.test(e.message)
      )
    ).toBe(true);
  });

  // manual-loops/provisioning-manifest-gaps-4.md T01, decision 2 — a service
  // env's `{ connectorRef }`/`{ connectorRef, endpointMethod, endpointPath }`
  // value is validated for connector NAME existence, mirroring the workflow
  // `connectorRef` case above.
  test("flags an unresolved connectorRef inside a service's env[] value", () => {
    const manifest = buildValidManifest();
    manifest.spec.services[0] = {
      ...manifest.spec.services[0],
      env: [
        {
          name: "HUBSPOT_CONNECTOR_ID",
          value: { connectorRef: "no-such-connector" },
        },
      ],
    };
    const errors = validateManifestStructuralRules(manifest);
    expect(
      errors.some(
        (e) =>
          e.path === "spec.services[0].env[0].value.connectorRef" &&
          /unresolved connectorRef "no-such-connector"/.test(e.message)
      )
    ).toBe(true);
  });

  test("passes with a service env connectorRef resolving to a declared connector", () => {
    const manifest = buildValidManifest();
    manifest.spec.services[0] = {
      ...manifest.spec.services[0],
      env: [
        { name: "HUBSPOT_CONNECTOR_ID", value: { connectorRef: "hubspot" } },
      ],
    };
    const errors = validateManifestStructuralRules(manifest);
    expect(errors.some((e) => /connectorRef/.test(e.message))).toBe(false);
  });

  // DOCUMENTED LIMITATION (decision 2, T01 scope): the endpoint-ref shape's
  // `endpointMethod`/`endpointPath` pair is NOT checked against the
  // connector's actual endpoint list at validate time — only the
  // `connectorRef` NAME is. A wrong (method, path) combination against a
  // resolvable connector is therefore NOT flagged here; T03 (apply time,
  // live re-fetch) is where that mismatch fails loud.
  test("passes with an endpoint-ref connectorRef resolving to a declared connector, regardless of endpointMethod/endpointPath (validate-time NAME-only check)", () => {
    const manifest = buildValidManifest();
    manifest.spec.services[0] = {
      ...manifest.spec.services[0],
      env: [
        {
          name: "HUBSPOT_DEALS_ENDPOINT_ID",
          value: {
            connectorRef: "hubspot",
            endpointMethod: "GET",
            endpointPath: "/this/endpoint/does/not/exist/on/the/connector",
          },
        },
      ],
    };
    const errors = validateManifestStructuralRules(manifest);
    expect(errors.some((e) => /connectorRef/.test(e.message))).toBe(false);
  });
});
