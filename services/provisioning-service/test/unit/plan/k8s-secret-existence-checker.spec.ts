import "../../setup-env";
import { describe, expect, it } from "bun:test";
import { createK8sSecretExistenceChecker } from "../../../src/modules/plan/infrastructure/k8s-secret-existence-checker";
import type { ISecretsStore } from "../../../src/modules/secrets/domain/secrets-store.interface";

function fakeStore(
  map: ReadonlyMap<string, ReadonlyMap<string, string>>
): ISecretsStore {
  return {
    async write() {
      return { ok: true };
    },
    async list() {
      return { ok: true, value: [] };
    },
    async readResourceSecret(_tenantId, kind, owner) {
      return { ok: true, value: map.get(`${kind}/${owner}`) ?? null };
    },
    // Required by `ISecretsStore` since PENDIENTES/12-undeploy.spec.md T01 —
    // the existence checker only ever reads.
    async deleteKey() {
      return { ok: true, value: { deleted: false } };
    },
  };
}

describe("createK8sSecretExistenceChecker", () => {
  it("returns true when the key exists in the resource's Secret", async () => {
    const store = fakeStore(
      new Map([["connector/hubspot", new Map([["hubspot-api-key", "v"]])]])
    );
    const checker = createK8sSecretExistenceChecker(store);
    const result = await checker.exists(
      "acme",
      "connector",
      "hubspot",
      "hubspot-api-key"
    );
    expect(result).toEqual({ ok: true, value: true });
  });

  it("returns false when no Secret exists for the resource yet", async () => {
    const store = fakeStore(new Map());
    const checker = createK8sSecretExistenceChecker(store);
    const result = await checker.exists(
      "acme",
      "connector",
      "hubspot",
      "hubspot-api-key"
    );
    expect(result).toEqual({ ok: true, value: false });
  });

  it("returns false when the Secret exists but lacks this key", async () => {
    const store = fakeStore(
      new Map([["connector/hubspot", new Map([["other-key", "v"]])]])
    );
    const checker = createK8sSecretExistenceChecker(store);
    const result = await checker.exists(
      "acme",
      "connector",
      "hubspot",
      "hubspot-api-key"
    );
    expect(result).toEqual({ ok: true, value: false });
  });

  it("never surfaces the value — existence only", async () => {
    const store = fakeStore(
      new Map([
        ["connector/hubspot", new Map([["hubspot-api-key", "super-secret"]])],
      ])
    );
    const checker = createK8sSecretExistenceChecker(store);
    const result = await checker.exists(
      "acme",
      "connector",
      "hubspot",
      "hubspot-api-key"
    );
    expect(JSON.stringify(result)).not.toContain("super-secret");
  });

  it("propagates a downstream error", async () => {
    const store: ISecretsStore = {
      async write() {
        return { ok: true };
      },
      async list() {
        return { ok: true, value: [] };
      },
      async readResourceSecret() {
        return {
          ok: false,
          error: { kind: "downstream_error", message: "k8s unavailable" },
        };
      },
      // Required by `ISecretsStore` (T01) — never called on this path.
      async deleteKey() {
        return { ok: true, value: { deleted: false } };
      },
    };
    const checker = createK8sSecretExistenceChecker(store);
    const result = await checker.exists(
      "acme",
      "connector",
      "hubspot",
      "hubspot-api-key"
    );
    expect(result).toEqual({ ok: false, error: "k8s unavailable" });
  });
});
