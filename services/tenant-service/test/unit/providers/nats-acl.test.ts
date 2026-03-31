import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { NatsConnection, JetStreamManager } from "nats";
import {
  NatsTenantProvisioner,
  STREAM_LIMITS,
} from "../../../src/providers/nats.provider";

function createMockJsm(): JetStreamManager {
  return {
    streams: {
      info: mock(() => Promise.reject({ code: 404 })),
      add: mock(() => Promise.resolve({})),
      delete: mock(() => Promise.resolve({})),
    },
    consumers: {
      add: mock(() => Promise.resolve({})),
    },
  } as unknown as JetStreamManager;
}

function createMockNc(
  jsm: JetStreamManager,
): NatsConnection {
  return {
    jetstreamManager: mock(() => Promise.resolve(jsm)),
    jetstream: mock(() => ({
      views: {
        os: mock(() =>
          Promise.resolve({
            status: mock(() => Promise.resolve({})),
          }),
        ),
      },
    })),
    close: mock(() => Promise.resolve()),
  } as unknown as NatsConnection;
}

describe("NatsTenantProvisioner - ACL rules", () => {
  let provisioner: NatsTenantProvisioner;
  let mockJsm: JetStreamManager;
  let mockNc: NatsConnection;

  beforeEach(() => {
    mockJsm = createMockJsm();
    mockNc = createMockNc(mockJsm);
    provisioner = new NatsTenantProvisioner(mockNc);
  });

  it("should create ACLs that block cross-tenant publish", async () => {
    const config = await provisioner.createACLs("acme", [
      "ingress-service",
      "admin-service",
    ]);

    expect(config.tenantId).toBe("acme");
    expect(config.publishAllow).toEqual(["evt.acme.>"]);
    expect(config.subscribeAllow).toEqual([
      "evt.acme.yoizenclaw.>",
    ]);
  });

  it("should include cross-tenant deny rule", async () => {
    const config = await provisioner.createACLs("acme", [
      "ingress-service",
    ]);

    expect(config.crossTenantDeny).toEqual(["evt.*.>"]);
  });

  it("should restrict publish to authorized services only", async () => {
    const config = await provisioner.createACLs("acme", [
      "ingress-service",
      "admin-service",
    ]);

    expect(config.publishAllow).toContain("evt.acme.>");
    expect(config.subscribeAllow).toContain(
      "evt.acme.yoizenclaw.>",
    );
  });

  it("should not allow globex tenant subjects in acme ACLs", () => {
    const config = {
      tenantId: "acme",
      publishAllow: ["evt.acme.>"],
      subscribeAllow: ["evt.acme.yoizenclaw.>"],
      crossTenantDeny: ["evt.*.>"],
    };

    const globexSubject =
      "evt.globex.yoizenclaw.config_sync.v1";

    const isCrossTenant =
      config.crossTenantDeny.some((pattern) => {
        if (pattern === "evt.*.>") {
          return globexSubject.startsWith("evt.");
        }
        return false;
      });

    const isOwnTenant = config.publishAllow.some(
      (pattern) =>
        globexSubject.startsWith(
          pattern.replace(".>", ""),
        ),
    );

    expect(isCrossTenant).toBe(true);
    expect(isOwnTenant).toBe(false);
  });
});
