import "../../setup-env";
import { describe, expect, it } from "bun:test";
import type {
  Agent,
  Connector,
  HostedService,
  ManifestChannel,
  ManifestSkill,
  Workflow,
} from "@yoizen/shared";
import { desiredFieldsOfResource } from "../../../src/modules/plan/lib/desired-fields-of-resource";

// The desired projection is the manifest side of the per-kind comparable
// contract (`comparable-fields.ts`). It MUST project exactly the fields the
// live side can also supply — no more — so `diffResource` never sees a
// one-sided key. Secret VALUES and credential fields never appear.

describe("desiredFieldsOfResource", () => {
  it("channel: projects only `type` (direction/config/secretRef excluded — no live counterpart)", () => {
    const channel: ManifestChannel = {
      name: "support-telegram",
      type: "telegram",
      direction: "inbound",
      config: { chatId: "123" },
      secretRef: "tg-bot-token",
    };
    expect(desiredFieldsOfResource("channel", channel)).toEqual({
      type: "telegram",
    });
  });

  it("connector: never projects `config`, `auth`, or auth material — only `endpoints` (T02)", () => {
    const connector: Connector = {
      name: "hubspot",
      type: "http",
      config: { baseUrl: "https://hubspot.example.com" },
      auth: {
        authType: "bearer",
        bearerToken: { secretRef: "hubspot-api-key" },
      },
    };
    expect(desiredFieldsOfResource("connector", connector)).toEqual({
      endpoints: [],
    });
  });

  it("connector: projects declared endpoints (label/method/path), sorted by (method, path)", () => {
    const connector: Connector = {
      name: "hubspot",
      type: "http",
      endpoints: [
        { label: "create-contact", method: "POST", path: "/contacts" },
        { label: "list-contacts", method: "get", path: "/contacts" },
      ],
    };
    expect(desiredFieldsOfResource("connector", connector)).toEqual({
      endpoints: [
        { label: "list-contacts", method: "GET", path: "/contacts" },
        { label: "create-contact", method: "POST", path: "/contacts" },
      ],
    });
  });

  it("agent: existence-only projection (profile/KB refs not faithfully comparable yet)", () => {
    const agent: Agent = {
      name: "support-agent",
      profile: { model: "gpt-4" },
      knowledgeBaseRefs: ["support-kb"],
    };
    expect(desiredFieldsOfResource("agent", agent)).toEqual({});
  });

  // manual-loops/demos/crm-support-telegram.md T04 findings ("STALE-STATE
  // MASKING") — service is now ALSO absent from this switch, mirroring the
  // workflow guard test below: `serviceEnvMechanismComparable`'s
  // `{ connectorRef }` resolution needs the SAME plan-time `resolvedIds`
  // substitution workflow refs need, I/O this pure dispatcher cannot do.
  // `build-manifest-plan.ts` branches around this function for
  // `kind === "service"` — see `service-comparable.spec.ts` and
  // `build-manifest-plan.spec.ts`'s service describe block for the actual
  // projection/plan-level coverage.
  it("service: falls to the empty default — build-manifest-plan.ts owns the service env-mechanism projection", () => {
    const service: HostedService = {
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      env: [{ name: "API_KEY", value: { secretRef: "scorer-api-key" } }],
    };
    expect(desiredFieldsOfResource("service", service)).toEqual({});
  });

  it("mcpServer (T07): projects transport_type/url/enabled — same key set the live side supplies, so a converged server reaches noop (not a forever-update)", () => {
    // Regression: before T07 the switch fell through to `default: {}`,
    // projecting an EMPTY desired shape while the live side supplied
    // transport_type/url/enabled — every field was a one-sided diff and the
    // plan verdict was a forever `update`.
    const mcpServer: ManifestMcpServer = {
      name: "sample-mcp-server",
      transport_type: "http",
      url: "https://mcp.example.com/mcp",
      auth: { authType: "bearer", token: { secretRef: "mcp-bearer" } },
      enabled: true,
    };
    expect(desiredFieldsOfResource("mcpServer", mcpServer)).toEqual({
      transport_type: "http",
      url: "https://mcp.example.com/mcp",
      enabled: true,
    });
  });

  it("mcpServer (T07): defaults `enabled` to true when the manifest omits it (mirrors the live default)", () => {
    const mcpServer: ManifestMcpServer = {
      name: "sample-mcp-server",
      transport_type: "http",
      url: "https://mcp.example.com/mcp",
    };
    expect(desiredFieldsOfResource("mcpServer", mcpServer)).toEqual({
      transport_type: "http",
      url: "https://mcp.example.com/mcp",
      enabled: true,
    });
  });

  it("workflow: falls to the empty default — build-manifest-plan.ts owns the workflow projection (substitute-then-project), so this dispatcher must NOT feed raw refs to workflowComparable", () => {
    // Guard against re-wiring `case "workflow"` into this switch: a workflow
    // definition WITH real content (application/actions carrying a symbolic
    // ref) must still project empty here. If someone reconnects the
    // content-aware comparator to this pure dispatcher, this fixture makes
    // the test fail loudly instead of coincidentally passing on an empty
    // definition (the pre-content-aware version of this test asserted {}
    // against a definition with no application/actions keys at all).
    const workflow: Workflow = {
      name: "ticket-router",
      definition: {
        application: "e2e",
        actions: [
          {
            name: "route",
            activity: "agentCall",
            args: { agentId: { agentRef: "support-agent" } },
          },
        ],
      },
    };
    expect(desiredFieldsOfResource("workflow", workflow)).toEqual({});
  });

  it("skill (T01, workstream a): projects every faithfully-comparable field — same key set the live side supplies, so a converged skill reaches noop (not a forever-update)", () => {
    // Regression: without this case the switch falls through to `default: {}`,
    // projecting an EMPTY desired shape while the live side (once T04's
    // skills client ships) supplies the real fields — every field a
    // one-sided diff, exactly mcpServer's T07 finding (c).
    const skill: ManifestSkill = {
      name: "refund-policy-expert",
      system_prompt: "You explain refund policy.",
      mode: "router",
    };
    expect(desiredFieldsOfResource("skill", skill)).toEqual({
      description: "",
      system_prompt: "You explain refund policy.",
      icon: "smart_toy",
      color: "#42a5f5",
      trigger_commands: [],
      when_to_use: "",
      priority: 0,
      allowed_tools: [],
      mode: "router",
      files: [],
    });
  });

  it("systemVariable (T04): projects `type` and `value` — both faithfully comparable, value is CONFIG not a secret", () => {
    const systemVariable: ManifestSystemVariable = {
      name: "escalation-threshold",
      type: "number",
      value: 5,
      label: "Escalation threshold",
      description: "Retries before escalation",
    };
    expect(desiredFieldsOfResource("systemVariable", systemVariable)).toEqual({
      type: "number",
      value: 5,
    });
  });
});
