import { describe, expect, it } from "bun:test";
import type { HostedService } from "@yoizen/shared";
import type { ApplyWriteError } from "../../../src/modules/apply/domain/apply.interfaces";
import type { FetchConnectorEndpointsOutcome } from "../../../src/modules/apply/lib/resolve-service-env-refs";
import { resolveServiceEnvRefs } from "../../../src/modules/apply/lib/resolve-service-env-refs";

const TENANT_ID = "tenant-a";

// manual-loops/provisioning-manifest-gaps-4.md T02/T03 — apply-time
// `{ connectorRef }` (whole-connector) and `{ connectorRef, endpointMethod,
// endpointPath }` (endpoint-ref) substitution for `service.env[]`.
describe("resolve-service-env-refs — T02/T03 apply-time connector/endpoint ref substitution", () => {
  function serviceWithEnv(env: HostedService["env"]): HostedService {
    return {
      name: "svc-1",
      image: "ghcr.io/yoizen/svc:latest",
      env,
    } as HostedService;
  }

  /** Never called — used to prove a code path never reaches the live GET. */
  function unreachableFetcher(): Promise<FetchConnectorEndpointsOutcome> {
    return Promise.reject(
      new Error("fetchConnectorEndpoints must never be called in this test")
    );
  }

  it("leaves literal string values untouched", async () => {
    const service = serviceWithEnv([{ name: "PLAIN", value: "marker" }]);
    const result = await resolveServiceEnvRefs({
      service,
      tenantId: TENANT_ID,
      resolveRef: () => undefined,
      fetchConnectorEndpoints: unreachableFetcher,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([{ name: "PLAIN", value: "marker" }]);
    }
  });

  it("resolves a { connectorRef } value to the connector's real id when resolvable (T02)", async () => {
    const service = serviceWithEnv([
      { name: "X", value: { connectorRef: "demo-hubspot" } },
    ]);
    const result = await resolveServiceEnvRefs({
      service,
      tenantId: TENANT_ID,
      resolveRef: (refType, name) =>
        refType === "connectorRef" && name === "demo-hubspot"
          ? "connector-real-id-42"
          : undefined,
      fetchConnectorEndpoints: unreachableFetcher,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([
        { name: "X", value: "connector-real-id-42" },
      ]);
    }
  });

  it("fails loud with unresolved_symbolic_ref when the connector name has no resolved real id (T02)", async () => {
    const service = serviceWithEnv([
      { name: "X", value: { connectorRef: "ghost-connector" } },
    ]);
    const result = await resolveServiceEnvRefs({
      service,
      tenantId: TENANT_ID,
      resolveRef: () => undefined,
      fetchConnectorEndpoints: unreachableFetcher,
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

  it("does NOT handle a { secretRef } value — passes it through untouched (T04 scope)", async () => {
    const service = serviceWithEnv([
      { name: "X", value: { secretRef: "scorer-password" } },
    ]);
    const result = await resolveServiceEnvRefs({
      service,
      tenantId: TENANT_ID,
      resolveRef: () => "should-not-be-called",
      fetchConnectorEndpoints: unreachableFetcher,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([
        { name: "X", value: { secretRef: "scorer-password" } },
      ]);
    }
  });

  it("returns an empty array when the service declares no env", async () => {
    const service = serviceWithEnv(undefined);
    const result = await resolveServiceEnvRefs({
      service,
      tenantId: TENANT_ID,
      resolveRef: () => undefined,
      fetchConnectorEndpoints: unreachableFetcher,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });

  // T03 — endpoint-ref shape: { connectorRef, endpointMethod, endpointPath }.
  describe("T03 — { connectorRef, endpointMethod, endpointPath } endpoint-ref substitution", () => {
    function endpointRefService(): HostedService {
      return serviceWithEnv([
        {
          name: "HUBSPOT_DEALS_ENDPOINT_ID",
          value: {
            connectorRef: "demo-hubspot",
            endpointMethod: "POST",
            endpointPath: "/crm/v3/objects/tickets",
          },
        },
      ]);
    }

    it("resolves to the matching live endpoint's real id", async () => {
      let capturedTenantId: string | undefined;
      let capturedConnectorId: string | undefined;
      const result = await resolveServiceEnvRefs({
        service: endpointRefService(),
        tenantId: TENANT_ID,
        resolveRef: (refType, name) =>
          refType === "connectorRef" && name === "demo-hubspot"
            ? "connector-real-id-42"
            : undefined,
        fetchConnectorEndpoints: async (tenantId, connectorId) => {
          capturedTenantId = tenantId;
          capturedConnectorId = connectorId;
          return {
            ok: true,
            endpoints: [
              {
                id: "ep-contacts",
                method: "GET",
                path: "/crm/v3/objects/contacts",
              },
              {
                id: "ep-tickets",
                method: "POST",
                path: "/crm/v3/objects/tickets",
              },
            ],
          };
        },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([
          { name: "HUBSPOT_DEALS_ENDPOINT_ID", value: "ep-tickets" },
        ]);
      }
      expect(capturedTenantId).toBe(TENANT_ID);
      expect(capturedConnectorId).toBe("connector-real-id-42");
    });

    it("matches method case-insensitively, mirroring connectors-writer.ts's own comparison", async () => {
      const result = await resolveServiceEnvRefs({
        service: endpointRefService(),
        tenantId: TENANT_ID,
        resolveRef: () => "connector-real-id-42",
        fetchConnectorEndpoints: async () => ({
          ok: true,
          endpoints: [
            {
              id: "ep-tickets",
              method: "post",
              path: "/crm/v3/objects/tickets",
            },
          ],
        }),
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([
          { name: "HUBSPOT_DEALS_ENDPOINT_ID", value: "ep-tickets" },
        ]);
      }
    });

    it("fails loud with endpoint_ref_not_found when method/path do not match any live endpoint on a resolvable connector", async () => {
      const result = await resolveServiceEnvRefs({
        service: endpointRefService(),
        tenantId: TENANT_ID,
        resolveRef: () => "connector-real-id-42",
        fetchConnectorEndpoints: async () => ({
          ok: true,
          endpoints: [
            {
              id: "ep-contacts",
              method: "GET",
              path: "/crm/v3/objects/contacts",
            },
          ],
        }),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("endpoint_ref_not_found");
        expect(result.error.resourceKind).toBe("service");
        expect(result.error.resourceName).toBe("svc-1");
        // Names connector, method, and path — never a value.
        expect(result.error.message).toContain("demo-hubspot");
        expect(result.error.message).toContain("POST");
        expect(result.error.message).toContain("/crm/v3/objects/tickets");
      }
    });

    it("fails loud with unresolved_symbolic_ref for an unresolvable connector name — connector resolution happens first, the live GET is never issued", async () => {
      const result = await resolveServiceEnvRefs({
        service: endpointRefService(),
        tenantId: TENANT_ID,
        resolveRef: () => undefined,
        fetchConnectorEndpoints: unreachableFetcher,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("unresolved_symbolic_ref");
        expect(result.error.message).toContain("connectorRef");
        expect(result.error.message).toContain("demo-hubspot");
      }
    });

    it("forwards the live GET's own failure as a typed error, never silently leaving the ref unresolved", async () => {
      const fetchError: ApplyWriteError = {
        kind: "downstream_error",
        resourceKind: "connector",
        resourceName: "connector-real-id-42",
        message: "HTTP 500 from GET /connectors/connector-real-id-42",
      };
      const result = await resolveServiceEnvRefs({
        service: endpointRefService(),
        tenantId: TENANT_ID,
        resolveRef: () => "connector-real-id-42",
        fetchConnectorEndpoints: async () => ({
          ok: false,
          error: fetchError,
        }),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual(fetchError);
      }
    });

    it("fails loud when no fetchConnectorEndpoints is wired at all — never silently passes the ref through", async () => {
      const result = await resolveServiceEnvRefs({
        service: endpointRefService(),
        tenantId: TENANT_ID,
        resolveRef: () => "connector-real-id-42",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("downstream_error");
        expect(result.error.message).toContain("demo-hubspot");
      }
    });
  });
});
