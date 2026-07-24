import { describe, expect, it } from "bun:test";
import type { HostedService } from "@yoizen/shared";
import { resolveServiceEnvRefs } from "../../../src/modules/apply/lib/resolve-service-env-refs";

// manual-loops/provisioning-manifest-gaps-4.md T02 — apply-time
// `{ connectorRef }` (whole-connector) substitution for `service.env[]`.
describe("resolve-service-env-refs — T02 apply-time { connectorRef } substitution", () => {
  function serviceWithEnv(env: HostedService["env"]): HostedService {
    return {
      name: "svc-1",
      image: "ghcr.io/yoizen/svc:latest",
      env,
    } as HostedService;
  }

  it("leaves literal string values untouched", () => {
    const service = serviceWithEnv([{ name: "PLAIN", value: "marker" }]);
    const result = resolveServiceEnvRefs({
      service,
      resolveRef: () => undefined,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([{ name: "PLAIN", value: "marker" }]);
    }
  });

  it("resolves a { connectorRef } value to the connector's real id when resolvable", () => {
    const service = serviceWithEnv([
      { name: "X", value: { connectorRef: "demo-hubspot" } },
    ]);
    const result = resolveServiceEnvRefs({
      service,
      resolveRef: (refType, name) =>
        refType === "connectorRef" && name === "demo-hubspot"
          ? "connector-real-id-42"
          : undefined,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([
        { name: "X", value: "connector-real-id-42" },
      ]);
    }
  });

  it("fails loud with unresolved_symbolic_ref when the connector name has no resolved real id", () => {
    const service = serviceWithEnv([
      { name: "X", value: { connectorRef: "ghost-connector" } },
    ]);
    const result = resolveServiceEnvRefs({
      service,
      resolveRef: () => undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unresolved_symbolic_ref");
      expect(result.error.resourceKind).toBe("service");
      expect(result.error.resourceName).toBe("svc-1");
      // value-free message: names the ref kind and the manifest name, never
      // the resolved/unresolved value itself beyond the symbolic name.
      expect(result.error.message).toContain("connectorRef");
      expect(result.error.message).toContain("ghost-connector");
      expect(result.error.message).toContain("env[0]");
    }
  });

  it("does NOT handle the endpoint-ref shape { connectorRef, endpointMethod, endpointPath } — passes it through untouched (T03 scope)", () => {
    const service = serviceWithEnv([
      {
        name: "X",
        value: {
          connectorRef: "demo-hubspot",
          endpointMethod: "GET",
          endpointPath: "/contacts",
        },
      },
    ]);
    const result = resolveServiceEnvRefs({
      service,
      resolveRef: () => "connector-real-id-42",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([
        {
          name: "X",
          value: {
            connectorRef: "demo-hubspot",
            endpointMethod: "GET",
            endpointPath: "/contacts",
          },
        },
      ]);
    }
  });

  it("does NOT handle a { secretRef } value — passes it through untouched (T04 scope)", () => {
    const service = serviceWithEnv([
      { name: "X", value: { secretRef: "scorer-password" } },
    ]);
    const result = resolveServiceEnvRefs({
      service,
      resolveRef: () => "should-not-be-called",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([
        { name: "X", value: { secretRef: "scorer-password" } },
      ]);
    }
  });

  it("returns an empty array when the service declares no env", () => {
    const service = serviceWithEnv(undefined);
    const result = resolveServiceEnvRefs({
      service,
      resolveRef: () => undefined,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });
});
