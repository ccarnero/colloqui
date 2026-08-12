import "../../setup-env";
import { describe, expect, it } from "bun:test";
import { NOOP_SECRET_AUDIT_PUBLISHER } from "../../../src/modules/secrets/domain/secret-audit-publisher.interface";
import type {
  ISecretsStore,
  SecretBindingSummary,
} from "../../../src/modules/secrets/domain/secrets-store.interface";
import { SecretsService } from "../../../src/modules/secrets/secrets.service";

function fakeStore(overrides: Partial<ISecretsStore> = {}): ISecretsStore {
  return {
    async write() {
      return { ok: true };
    },
    async list() {
      return { ok: true, value: [] };
    },
    async readResourceSecret() {
      return { ok: true, value: null };
    },
    // PENDIENTES/12-undeploy.spec.md T01: `deleteKey` is REQUIRED on
    // `ISecretsStore`, so the base fixture must satisfy it too — the tests
    // that exercise deletion pass their own via `overrides`.
    async deleteKey() {
      return { ok: true, value: { deleted: false } };
    },
    ...overrides,
  };
}

describe("SecretsService", () => {
  it("write: echoes back ONLY {name, scope} — never the value", async () => {
    const service = new SecretsService(
      fakeStore(),
      NOOP_SECRET_AUDIT_PUBLISHER
    );
    const result = await service.write("acme", "hubspot-api-key", {
      value: "super-secret-value",
      scope: { kind: "connector", owner: "hubspot" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        name: "hubspot-api-key",
        scope: { kind: "connector", owner: "hubspot" },
      });
      expect(JSON.stringify(result.value)).not.toContain("super-secret-value");
    }
  });

  it("write: surfaces a typed store error without ever mentioning a value", async () => {
    const store = fakeStore({
      async write() {
        return {
          ok: false,
          error: { kind: "downstream_error", message: "k8s unavailable" },
        };
      },
    });
    const service = new SecretsService(store, NOOP_SECRET_AUDIT_PUBLISHER);
    const result = await service.write("acme", "x", {
      value: "v",
      scope: { kind: "agent", owner: "bot-1" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe("k8s unavailable");
    }
  });

  it("list: returns names + bindings ONLY", async () => {
    const bindings: SecretBindingSummary[] = [
      {
        name: "hubspot-api-key",
        scope: { kind: "connector", owner: "hubspot" },
      },
    ];
    const store = fakeStore({
      async list() {
        return { ok: true, value: bindings };
      },
    });
    const service = new SecretsService(store, NOOP_SECRET_AUDIT_PUBLISHER);
    const result = await service.list("acme");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(bindings);
    }
  });

  it("write: emits a secretWritten audit event with no value", async () => {
    let captured: unknown;
    const audit = {
      ...NOOP_SECRET_AUDIT_PUBLISHER,
      async secretWritten(event: unknown) {
        captured = event;
      },
    };
    const service = new SecretsService(fakeStore(), audit);
    await service.write("acme", "hubspot-api-key", {
      value: "super-secret-value",
      scope: { kind: "connector", owner: "hubspot" },
    });
    expect(captured).toEqual({
      tenantId: "acme",
      secretName: "hubspot-api-key",
      kind: "connector",
      owner: "hubspot",
    });
    expect(JSON.stringify(captured)).not.toContain("super-secret-value");
  });

  // PENDIENTES/12-undeploy.spec.md T01 item 4 / decision 2.
  it("delete: echoes {name, scope, deleted} — never a value", async () => {
    const store = fakeStore({
      async deleteKey() {
        return { ok: true, value: { deleted: true } };
      },
    });
    const service = new SecretsService(store, NOOP_SECRET_AUDIT_PUBLISHER);

    const result = await service.delete("acme", "hubspot-api-key", {
      kind: "connector",
      owner: "hubspot",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toEqual({
      name: "hubspot-api-key",
      scope: { kind: "connector", owner: "hubspot" },
      deleted: true,
    });
  });

  it("delete: reports deleted:false for an absent secret instead of failing (idempotent)", async () => {
    const store = fakeStore({
      async deleteKey() {
        return { ok: true, value: { deleted: false } };
      },
    });
    const service = new SecretsService(store, NOOP_SECRET_AUDIT_PUBLISHER);

    const result = await service.delete("acme", "gone", {
      kind: "channel",
      owner: "http-in",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.deleted).toBe(false);
  });

  it("delete: forwards the scope verbatim to the store so the right k8s Secret is touched", async () => {
    let captured: unknown;
    const store = fakeStore({
      async deleteKey(tenantId, name, scope) {
        captured = { tenantId, name, scope };
        return { ok: true, value: { deleted: true } };
      },
    });
    const service = new SecretsService(store, NOOP_SECRET_AUDIT_PUBLISHER);

    await service.delete("acme", "tg-token", {
      kind: "channel",
      owner: "http-in",
    });

    expect(captured).toEqual({
      tenantId: "acme",
      name: "tg-token",
      scope: { kind: "channel", owner: "http-in" },
    });
  });

  it("delete: surfaces a typed store error", async () => {
    const store = fakeStore({
      async deleteKey() {
        return {
          ok: false,
          error: { kind: "downstream_error", message: "k8s unavailable" },
        };
      },
    });
    const service = new SecretsService(store, NOOP_SECRET_AUDIT_PUBLISHER);

    const result = await service.delete("acme", "x", {
      kind: "agent",
      owner: "bot-1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toBe("k8s unavailable");
  });
});
