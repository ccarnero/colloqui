import { describe, it, expect } from "bun:test";
import {
  mapRegisteredServiceRow,
  mapServiceRouteRow,
  mapCanaryDeploymentRow,
} from "../../src/common/registry-row-mappers";

describe("registry-row-mappers", () => {
  it("mapRegisteredServiceRow maps snake_case DB row to API shape", () => {
    const out = mapRegisteredServiceRow({
      id: "s1",
      tenant_id: "t1",
      name: "svc",
      image: "img:1",
      port: 8080,
      min_scale: 1,
      max_scale: 3,
      concurrency_target: 50,
      env_vars: { FOO: "bar" },
      status: "ready",
      knative_name: "ksvc",
      namespace: "ns",
      created_at: "2020-01-01",
      updated_at: "2020-01-02",
    });
    expect(out).toEqual({
      id: "s1",
      tenantId: "t1",
      name: "svc",
      image: "img:1",
      port: 8080,
      minScale: 1,
      maxScale: 3,
      concurrencyTarget: 50,
      envVars: { FOO: "bar" },
      status: "ready",
      knativeName: "ksvc",
      namespace: "ns",
      createdAt: "2020-01-01",
      updatedAt: "2020-01-02",
    });
  });

  it("mapRegisteredServiceRow uses empty envVars when env_vars invalid", () => {
    const out = mapRegisteredServiceRow({
      id: "s1",
      tenant_id: "t1",
      name: "svc",
      image: "img",
      port: 0,
      min_scale: 0,
      max_scale: 0,
      concurrency_target: 0,
      env_vars: [1, 2],
      status: "",
      knative_name: null,
      namespace: null,
      created_at: "",
      updated_at: "",
    });
    expect(out.envVars).toEqual({});
    expect(out.knativeName).toBeNull();
    expect(out.namespace).toBeNull();
  });

  it("mapServiceRouteRow maps methods array", () => {
    const out = mapServiceRouteRow({
      id: "r1",
      service_id: "s1",
      path_prefix: "/api",
      methods: ["GET", "POST"],
      is_public: true,
      strip_prefix: false,
      created_at: "x",
    });
    expect(out.methods).toEqual(["GET", "POST"]);
    expect(out.isPublic).toBe(true);
    expect(out.stripPrefix).toBe(false);
  });

  it("mapServiceRouteRow uses empty methods when not array", () => {
    const out = mapServiceRouteRow({
      id: "r1",
      service_id: "s1",
      path_prefix: "/",
      methods: "GET",
      is_public: false,
      strip_prefix: true,
      created_at: "x",
    });
    expect(out.methods).toEqual([]);
  });

  it("mapCanaryDeploymentRow maps fields", () => {
    const out = mapCanaryDeploymentRow({
      id: "c1",
      service_id: "s1",
      stable_revision: "a",
      canary_revision: "b",
      canary_percent: 25,
      status: "progressing",
      created_at: "t1",
      updated_at: "t2",
    });
    expect(out.canaryPercent).toBe(25);
    expect(out.stableRevision).toBe("a");
  });
});
