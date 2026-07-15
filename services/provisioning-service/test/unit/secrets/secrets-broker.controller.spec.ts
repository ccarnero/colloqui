import "../../setup-env";
import { describe, expect, it } from "bun:test";
import { SecretsBrokerController } from "../../../src/modules/secrets/broker/secrets-broker.controller";
import { SecretsBrokerService } from "../../../src/modules/secrets/broker/secrets-broker.service";
import { NOOP_SECRET_AUDIT_PUBLISHER } from "../../../src/modules/secrets/domain/secret-audit-publisher.interface";
import type { ISecretsStore } from "../../../src/modules/secrets/domain/secrets-store.interface";

const SECRET_TOKEN = "sk-controller-secret-VALUE-marker";

function storeWithBinding(): ISecretsStore {
  const data = new Map([["hubspot-api-key", SECRET_TOKEN]]);
  return {
    async write() {
      return { ok: true };
    },
    async list() {
      return { ok: true, value: [] };
    },
    async readResourceSecret(_tenantId, kind, owner) {
      if (kind === "connector" && owner === "hubspot") {
        return { ok: true, value: data };
      }
      return { ok: true, value: null };
    },
  };
}

describe("SecretsBrokerController", () => {
  it("POST /internal/secrets/resolve resolves a valid request", async () => {
    const broker = new SecretsBrokerService(
      storeWithBinding(),
      NOOP_SECRET_AUDIT_PUBLISHER
    );
    const controller = new SecretsBrokerController(broker);

    const response = await controller.resolve("acme", {
      consumerService: "provisioning-service-apply-engine",
      secretName: "hubspot-api-key",
      actingResource: { kind: "connector", owner: "hubspot" },
      correlationId: "run-1",
    });

    expect(response.ok).toBe(true);
  });

  it("rejects an incomplete request body with a typed error, never touching the store", async () => {
    const broker = new SecretsBrokerService(
      storeWithBinding(),
      NOOP_SECRET_AUDIT_PUBLISHER
    );
    const controller = new SecretsBrokerController(broker);

    const response = await controller.resolve("acme", {
      secretName: "hubspot-api-key",
    });

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.kind).toBe("invalid_request");
    }
  });
});
