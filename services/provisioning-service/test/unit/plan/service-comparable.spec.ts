import "../../setup-env";
import { describe, expect, it } from "bun:test";
import type { HostedService } from "@yoizen/shared";
import {
  type RegisteredServiceDto,
  serviceComparable,
  serviceEnvMechanismComparable,
} from "../../../src/modules/plan/lib/comparable-fields";

// manual-loops/demos/crm-support-telegram.md T04 findings ("STALE-STATE MASKING").
//
// `serviceComparable` (envNames-only) is now ONLY the source for the
// non-env fields (routes/scaling) `serviceEnvMechanismComparable` reuses —
// it is no longer a whole-service plan-time fallback (a fresh-context
// review found that whole-service degradation defeated the feature for its
// own motivating case; degradation is now PER ENV ENTRY, inside
// `serviceEnvMechanismComparable` itself). Kept here (moved from
// `desired-fields-of-resource.spec.ts` once `desiredFieldsOfResource`
// stopped special-casing "service", mirroring how "workflow" was already
// absent from that dispatcher).
describe("serviceComparable (envNames-only projection, reused for non-env fields)", () => {
  it("projects env var NAMES only, sorted (never values, never secretRef, never image/buildRef)", () => {
    const service: HostedService = {
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      env: [
        { name: "ZED_VAR", value: "whatever" },
        { name: "API_KEY", value: { secretRef: "scorer-api-key" } },
      ],
    };
    expect(serviceComparable.fromManifest(service)).toEqual({
      envNames: ["API_KEY", "ZED_VAR"],
      routes: [],
    });
  });

  it("projects declared scaling fields (T05, gap 5) — only the ones the manifest declares", () => {
    const service: HostedService = {
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      port: 8080,
      maxScale: 5,
    };
    expect(serviceComparable.fromManifest(service)).toEqual({
      envNames: [],
      routes: [],
      port: 8080,
      maxScale: 5,
    });
  });

  it("projects declared routes, normalized and sorted (T05, gap 5)", () => {
    const service: HostedService = {
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      routes: [{ pathPrefix: "/b", methods: ["get"] }, { pathPrefix: "/a" }],
    };
    expect(serviceComparable.fromManifest(service)).toEqual({
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
});

// `serviceEnvMechanismComparable` — the mechanism-aware comparator this task
// adds. Closes the gap: envNames-only comparison could not tell a plaintext
// literal apart from a `secretRef`-bound (k8s `valueFrom.secretKeyRef`) or a
// resolved connector/endpoint-ref env var with the SAME name, so a mechanism
// regression (e.g. a credential leaking to a plaintext literal) reported
// `noop` instead of `update`.
//
// Degradation is now PER ENTRY (`mechanism: "unresolved"`), never
// whole-service — a fresh-context review found the earlier whole-service
// `{ ok: false }` fallback defeated the feature for its own motivating case:
// a service mixing a `secretRef` var with an ALWAYS-unresolvable
// endpoint-ref var (e.g. `demos/crm-support-telegram/manifest.yaml`'s
// `priority-scorer`) never got its secretRef var mechanism-checked.
describe("serviceEnvMechanismComparable.fromManifest", () => {
  it("projects a plain string literal as mechanism 'plain' with its value (schema-guaranteed non-secret)", () => {
    const service: HostedService = {
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      env: [{ name: "YOIZEN_TENANT", value: "acme" }],
    };
    expect(serviceEnvMechanismComparable.fromManifest(service)).toEqual({
      routes: [],
      env: [{ name: "YOIZEN_TENANT", mechanism: "plain", value: "acme" }],
    });
  });

  it("projects a { secretRef } value as mechanism 'secretKeyRef' with the deterministic k8s Secret identity (never a value)", () => {
    const service: HostedService = {
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      env: [{ name: "API_KEY", value: { secretRef: "scorer-api-key" } }],
    };
    expect(serviceEnvMechanismComparable.fromManifest(service)).toEqual({
      routes: [],
      env: [
        {
          name: "API_KEY",
          mechanism: "secretKeyRef",
          secretKeyRef: {
            name: "psec-service-priority-scorer",
            key: "scorer-api-key",
          },
        },
      ],
    });
  });

  it("resolves a { connectorRef } value through the injected resolver to a plain mechanism with the resolved id", () => {
    const service: HostedService = {
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      env: [
        { name: "HUBSPOT_CONNECTOR_ID", value: { connectorRef: "hubspot" } },
      ],
    };
    const result = serviceEnvMechanismComparable.fromManifest(
      service,
      (connectorName) => (connectorName === "hubspot" ? "conn-123" : undefined)
    );
    expect(result).toEqual({
      routes: [],
      env: [
        {
          name: "HUBSPOT_CONNECTOR_ID",
          mechanism: "plain",
          value: "conn-123",
        },
      ],
    });
  });

  it("projects mechanism 'unresolved' (only THAT entry) when a { connectorRef } cannot be resolved", () => {
    const service: HostedService = {
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      env: [
        { name: "API_KEY", value: { secretRef: "scorer-api-key" } },
        { name: "HUBSPOT_CONNECTOR_ID", value: { connectorRef: "hubspot" } },
      ],
    };
    expect(serviceEnvMechanismComparable.fromManifest(service)).toEqual({
      routes: [],
      env: [
        {
          name: "API_KEY",
          mechanism: "secretKeyRef",
          secretKeyRef: {
            name: "psec-service-priority-scorer",
            key: "scorer-api-key",
          },
        },
        { name: "HUBSPOT_CONNECTOR_ID", mechanism: "unresolved" },
      ],
    });
  });

  it("projects mechanism 'unresolved' (only THAT entry) for an endpoint-ref shape — plan time never resolves it (only apply time does) — sibling entries stay fully mechanism-aware", () => {
    const service: HostedService = {
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      env: [
        { name: "API_KEY", value: { secretRef: "scorer-api-key" } },
        {
          name: "HUBSPOT_DEALS_ENDPOINT_ID",
          value: {
            connectorRef: "hubspot",
            endpointMethod: "GET",
            endpointPath: "/crm/v3/objects/deals",
          },
        },
      ],
    };
    const result = serviceEnvMechanismComparable.fromManifest(
      service,
      () => "conn-123"
    );
    expect(result).toEqual({
      routes: [],
      env: [
        {
          name: "API_KEY",
          mechanism: "secretKeyRef",
          secretKeyRef: {
            name: "psec-service-priority-scorer",
            key: "scorer-api-key",
          },
        },
        { name: "HUBSPOT_DEALS_ENDPOINT_ID", mechanism: "unresolved" },
      ],
    });
  });

  it("sorts env entries by name before projecting", () => {
    const service: HostedService = {
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      env: [
        { name: "ZED_VAR", value: "z" },
        { name: "API_KEY", value: { secretRef: "scorer-api-key" } },
      ],
    };
    const result = serviceEnvMechanismComparable.fromManifest(service);
    expect(result.env).toEqual([
      {
        name: "API_KEY",
        mechanism: "secretKeyRef",
        secretKeyRef: {
          name: "psec-service-priority-scorer",
          key: "scorer-api-key",
        },
      },
      { name: "ZED_VAR", mechanism: "plain", value: "z" },
    ]);
  });
});

describe("serviceEnvMechanismComparable.fromLive", () => {
  it("projects a live secretKeyRef entry by identity, never a value", () => {
    const live: RegisteredServiceDto = {
      id: "svc-1",
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      envVars: {
        API_KEY: {
          secretKeyRef: {
            name: "psec-service-priority-scorer",
            key: "scorer-api-key",
          },
        },
      },
    };
    expect(serviceEnvMechanismComparable.fromLive(live)).toEqual({
      routes: [],
      env: [
        {
          name: "API_KEY",
          mechanism: "secretKeyRef",
          secretKeyRef: {
            name: "psec-service-priority-scorer",
            key: "scorer-api-key",
          },
        },
      ],
    });
  });

  it("echoes a live plain value when it is BYTE-FOR-BYTE equal to the manifest's own declared literal", () => {
    const declared: HostedService = {
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      env: [{ name: "YOIZEN_TENANT", value: "acme" }],
    };
    const live: RegisteredServiceDto = {
      id: "svc-1",
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      envVars: { YOIZEN_TENANT: "acme" },
    };
    expect(serviceEnvMechanismComparable.fromLive(live, declared)).toEqual({
      routes: [],
      env: [{ name: "YOIZEN_TENANT", mechanism: "plain", value: "acme" }],
    });
  });

  // DEFECT 2 (fresh-context review, HIGH): a live row can drift out-of-band
  // to hold a credential under a name the manifest declares as a plain
  // literal. Echoing the live value verbatim in that case would leak it.
  // Fix: byte-for-byte gating — only echo when live === the manifest's OWN
  // known-safe expected value; otherwise project a stable, non-secret
  // sentinel (never the live string) so the mismatch still surfaces.
  it("NEVER echoes a live plain value that disagrees with the manifest's declared literal — omits `value` so the missing key alone diffs", () => {
    const LIVE_CREDENTIAL = "sk-live-drifted-credential-DO-NOT-LEAK";
    const declared: HostedService = {
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      env: [{ name: "YOIZEN_TENANT", value: "acme" }],
    };
    const live: RegisteredServiceDto = {
      id: "svc-1",
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      envVars: { YOIZEN_TENANT: LIVE_CREDENTIAL },
    };

    const projection = serviceEnvMechanismComparable.fromLive(live, declared);

    expect(projection).toEqual({
      routes: [],
      env: [{ name: "YOIZEN_TENANT", mechanism: "plain" }],
    });
    expect(JSON.stringify(projection)).not.toContain(LIVE_CREDENTIAL);
    // And it still diffs against the manifest's own value ("acme").
    expect(serviceEnvMechanismComparable.fromManifest(declared).env).toEqual([
      { name: "YOIZEN_TENANT", mechanism: "plain", value: "acme" },
    ]);
  });

  it("sentinel-collision guard: a manifest literal whose value could mimic any redaction marker still surfaces drift as update", () => {
    // Regression for the rework's LOW defect: with a fixed sentinel string,
    // a manifest literal equal to that sentinel + a drifted live value
    // produced a false noop. Omission has no collision surface: drift on a
    // literal ALWAYS projects live `{name, mechanism}` vs desired
    // `{name, mechanism, value}` — never equal.
    const declared: HostedService = {
      name: "svc",
      image: "img:1",
      env: [{ name: "MARKERISH", value: "<redacted-drift>" }],
    };
    const live: RegisteredServiceDto = {
      id: "svc-1",
      name: "svc",
      image: "img:1",
      envVars: { MARKERISH: "actually-drifted-elsewhere" },
    };

    const desired = serviceEnvMechanismComparable.fromManifest(declared);
    const current = serviceEnvMechanismComparable.fromLive(live, declared);

    expect(desired.env).toEqual([
      { name: "MARKERISH", mechanism: "plain", value: "<redacted-drift>" },
    ]);
    expect(current.env).toEqual([{ name: "MARKERISH", mechanism: "plain" }]);
    expect(desired).not.toEqual(current);
  });

  // THE INCIDENT (manual-loops/demos/crm-support-telegram.md T04 findings):
  // manifest declares `secretRef`, but the live Knative spec regressed to a
  // plaintext literal for the SAME env var name. The live plaintext value
  // must NEVER be read into the projection — only the mechanism mismatch
  // itself (`"plain"` vs the manifest's own `"secretKeyRef"`) may surface.
  it("NEVER echoes a live plain value when the manifest declares { secretRef } for this name (mechanism mismatch, the incident case)", () => {
    const PLAINTEXT_CREDENTIAL = "sk-live-yoizen-credential-DO-NOT-LEAK";
    const declared: HostedService = {
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      env: [{ name: "YOIZEN_API_KEY", value: { secretRef: "yoizen-api-key" } }],
    };
    const live: RegisteredServiceDto = {
      id: "svc-1",
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      envVars: { YOIZEN_API_KEY: PLAINTEXT_CREDENTIAL },
    };

    const projection = serviceEnvMechanismComparable.fromLive(live, declared);

    expect(projection).toEqual({
      routes: [],
      env: [{ name: "YOIZEN_API_KEY", mechanism: "plain" }],
    });
    expect(JSON.stringify(projection)).not.toContain(PLAINTEXT_CREDENTIAL);

    // And the manifest's OWN projection for this same var is "secretKeyRef"
    // — the mismatch is what makes `diffResource` report `update`.
    expect(serviceEnvMechanismComparable.fromManifest(declared)).toEqual({
      routes: [],
      env: [
        {
          name: "YOIZEN_API_KEY",
          mechanism: "secretKeyRef",
          secretKeyRef: {
            name: "psec-service-priority-scorer",
            key: "yoizen-api-key",
          },
        },
      ],
    });
  });

  it("never echoes a live plain value for an UNDECLARED (extra, live-only) env var", () => {
    const live: RegisteredServiceDto = {
      id: "svc-1",
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      envVars: { LEFTOVER_VAR: "some-value" },
    };
    expect(serviceEnvMechanismComparable.fromLive(live)).toEqual({
      routes: [],
      env: [{ name: "LEFTOVER_VAR", mechanism: "plain" }],
    });
  });

  // DEFECT 1 (fresh-context review, CRITICAL): a service mixing a
  // `secretRef` var with an unresolvable (endpoint-ref) var must still get
  // the secretRef var mechanism-checked — the unresolvable sibling must
  // project identically on both sides (no spurious diff), never degrade the
  // whole service.
  it("projects mechanism 'unresolved' for an endpoint-ref-declared name regardless of the live value's actual shape — never inspects it", () => {
    const declared: HostedService = {
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      env: [
        {
          name: "HUBSPOT_DEALS_ENDPOINT_ID",
          value: {
            connectorRef: "hubspot",
            endpointMethod: "GET",
            endpointPath: "/crm/v3/objects/deals",
          },
        },
      ],
    };
    const live: RegisteredServiceDto = {
      id: "svc-1",
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      envVars: { HUBSPOT_DEALS_ENDPOINT_ID: "ep-456" },
    };
    expect(serviceEnvMechanismComparable.fromLive(live, declared)).toEqual({
      routes: [],
      env: [{ name: "HUBSPOT_DEALS_ENDPOINT_ID", mechanism: "unresolved" }],
    });
    // The manifest side projects the SAME thing, so this entry noops.
    expect(serviceEnvMechanismComparable.fromManifest(declared)).toEqual({
      routes: [],
      env: [{ name: "HUBSPOT_DEALS_ENDPOINT_ID", mechanism: "unresolved" }],
    });
  });
});
