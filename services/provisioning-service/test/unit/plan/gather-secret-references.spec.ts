import "../../setup-env";
import { describe, expect, it } from "bun:test";
import type { IntegrationManifest } from "@yoizen/shared";
import { gatherSecretReferences } from "../../../src/modules/plan/lib/gather-secret-references";

function buildManifest(): IntegrationManifest {
  return {
    apiVersion: "yoizen.io/v1",
    kind: "IntegrationManifest",
    metadata: { name: "crm-support" },
    spec: {
      channels: [
        {
          name: "support-telegram",
          type: "telegram",
          direction: "inbound",
          secretRef: "tg-bot-token",
        },
      ],
      connectors: [
        {
          name: "hubspot",
          type: "http",
          auth: {
            authType: "bearer",
            bearerToken: { secretRef: "hubspot-api-key" },
          },
        },
      ],
      agents: [{ name: "support-agent", profile: {} }],
      knowledgeBases: [],
      services: [
        {
          name: "priority-scorer",
          image: "registry.example.com/priority-scorer:1.0",
          env: [{ name: "API_KEY", secretRef: "scorer-api-key" }],
        },
      ],
      workflows: [],
      secrets: [
        {
          name: "tg-bot-token",
          scope: { kind: "channel", owner: "support-telegram" },
        },
        {
          name: "hubspot-api-key",
          scope: { kind: "connector", owner: "hubspot" },
        },
        {
          name: "scorer-api-key",
          scope: { kind: "service", owner: "priority-scorer" },
          external: true,
        },
      ],
    },
  };
}

describe("gatherSecretReferences", () => {
  it("finds channel/connector secretRef and service env secretRef", () => {
    const manifest = buildManifest();
    const refs = gatherSecretReferences(manifest);
    const byName = new Map(refs.map((r) => [r.secretName, r]));

    expect(byName.get("tg-bot-token")).toEqual({
      secretName: "tg-bot-token",
      owningKind: "channel",
      owningName: "support-telegram",
    });
    expect(byName.get("hubspot-api-key")).toEqual({
      secretName: "hubspot-api-key",
      owningKind: "connector",
      owningName: "hubspot",
    });
    expect(byName.get("scorer-api-key")).toEqual({
      secretName: "scorer-api-key",
      owningKind: "service",
      owningName: "priority-scorer",
    });
  });

  it("dedupes when the same secret name is referenced more than once", () => {
    const manifest = buildManifest();
    manifest.spec.connectors.push({
      name: "second-connector",
      type: "http",
      auth: {
        authType: "bearer",
        bearerToken: { secretRef: "tg-bot-token" },
      },
    });

    const refs = gatherSecretReferences(manifest);
    const occurrences = refs.filter((r) => r.secretName === "tg-bot-token");
    expect(occurrences).toHaveLength(1);
    // first occurrence wins (channel, declared before the pushed connector)
    expect(occurrences[0]?.owningKind).toBe("channel");
  });

  it("returns an empty list when nothing references a secret", () => {
    const manifest = buildManifest();
    manifest.spec.channels[0]!.secretRef = undefined;
    manifest.spec.connectors[0]!.auth = undefined;
    manifest.spec.services[0]!.env = [];

    const refs = gatherSecretReferences(manifest);
    expect(refs).toEqual([]);
  });

  // manual-loops/provisioning-manifest-gaps-4.md T01 — REGRESSION proving
  // decision 7's citation holds against the WIDENED schema shape
  // (`{ name, value: { secretRef } }`, `value` nested one level deeper than
  // the pre-widening fixture above): `collectSymbolicRefs` recurses at ANY
  // nesting depth for a `secretRef`-named key with a string value, and
  // `parse-owning-resource.ts`'s `SECTION_TO_KIND` already maps
  // `services: "service"` (added for the workflow `serviceRef` case, but
  // generically keyed) — so `gatherSecretReferences` picks up a
  // `spec.services[N].env[M].value.secretRef` occurrence correctly with
  // ZERO changes to either file. Verified, not assumed.
  it("finds a service env secretRef nested under the T01 `{ value: { secretRef } }` shape", () => {
    const manifest = buildManifest();
    manifest.spec.services[0]!.env = [
      { name: "API_KEY", value: { secretRef: "scorer-api-key" } },
    ];

    const refs = gatherSecretReferences(manifest);
    const byName = new Map(refs.map((r) => [r.secretName, r]));

    expect(byName.get("scorer-api-key")).toEqual({
      secretName: "scorer-api-key",
      owningKind: "service",
      owningName: "priority-scorer",
    });
  });
});
