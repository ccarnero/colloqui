import "../../setup-env";
import { describe, expect, it } from "bun:test";
import type {
  Agent,
  Connector,
  HostedService,
  ManifestChannel,
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

  it("service: projects env var NAMES only, sorted (never values, never secretRef, never image/buildRef)", () => {
    const service: HostedService = {
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      env: [
        { name: "ZED_VAR" },
        { name: "API_KEY", secretRef: "scorer-api-key" },
      ],
    };
    // T05 (gap 5): `routes` always projects (empty array when undeclared,
    // mirroring `connectorComparable`'s endpoint precedent); scaling fields
    // are absent here because the manifest never declared them.
    expect(desiredFieldsOfResource("service", service)).toEqual({
      envNames: ["API_KEY", "ZED_VAR"],
      routes: [],
    });
  });

  it("service: buildRef-declared service projects the same env-only shape (no image/buildRef key)", () => {
    const service: HostedService = {
      name: "built-service",
      buildRef: "git:abc123",
      env: [{ name: "PORT" }],
    };
    expect(desiredFieldsOfResource("service", service)).toEqual({
      envNames: ["PORT"],
      routes: [],
    });
  });

  it("service: projects declared scaling fields (T05, gap 5) — only the ones the manifest declares", () => {
    const service: HostedService = {
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      port: 8080,
      maxScale: 5,
    };
    expect(desiredFieldsOfResource("service", service)).toEqual({
      envNames: [],
      routes: [],
      port: 8080,
      maxScale: 5,
    });
  });

  it("service: projects declared routes, normalized and sorted (T05, gap 5)", () => {
    const service: HostedService = {
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      routes: [{ pathPrefix: "/b", methods: ["get"] }, { pathPrefix: "/a" }],
    };
    expect(desiredFieldsOfResource("service", service)).toEqual({
      envNames: [],
      routes: [
        {
          pathPrefix: "/a",
          methods: ["DELETE", "GET", "PATCH", "POST", "PUT"],
          isPublic: false,
          stripPrefix: true,
        },
        {
          pathPrefix: "/b",
          methods: ["GET"],
          isPublic: false,
          stripPrefix: true,
        },
      ],
    });
  });

  it("workflow: existence-only projection (opaque definition not mappable to actions/trigger/variables)", () => {
    const workflow: Workflow = {
      name: "ticket-router",
      definition: { steps: [{ type: "agentCall", agentRef: "support-agent" }] },
    };
    expect(desiredFieldsOfResource("workflow", workflow)).toEqual({});
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
