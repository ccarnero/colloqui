import "../../setup-env";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type * as k8s from "@kubernetes/client-node";
import { createK8sSecretsStore } from "../../../src/modules/secrets/infrastructure/k8s-secrets-store";
import { SECRET_LABEL_KEYS } from "../../../src/modules/secrets/lib/secret-labels";

const SECRET_TOKEN = "sk-super-secret-token-VALUE-marker-9f8e7d6c";

function notFoundError(): unknown {
  return { response: { statusCode: 404 } };
}

/** Minimal in-memory fake of the CoreV1Api surface the store calls. */
function fakeCoreApi() {
  const secrets = new Map<string, k8s.V1Secret>();

  return {
    secrets,
    async readNamespacedSecret({
      name,
      namespace,
    }: {
      name: string;
      namespace: string;
    }) {
      const found = secrets.get(`${namespace}/${name}`);
      if (!found) {
        throw notFoundError();
      }
      return found;
    },
    async createNamespacedSecret({
      namespace,
      body,
    }: {
      namespace: string;
      body: k8s.V1Secret;
    }) {
      secrets.set(`${namespace}/${body.metadata?.name}`, body);
      return body;
    },
    async replaceNamespacedSecret({
      name,
      namespace,
      body,
    }: {
      name: string;
      namespace: string;
      body: k8s.V1Secret;
    }) {
      secrets.set(`${namespace}/${name}`, body);
      return body;
    },
    async deleteNamespacedSecret({
      name,
      namespace,
    }: {
      name: string;
      namespace: string;
    }) {
      const key = `${namespace}/${name}`;
      if (!secrets.has(key)) {
        throw notFoundError();
      }
      secrets.delete(key);
      return {};
    },
    async listNamespacedSecret({
      namespace,
    }: {
      namespace: string;
      labelSelector?: string;
    }) {
      const items = [...secrets.entries()]
        .filter(([key]) => key.startsWith(`${namespace}/`))
        .map(([, value]) => value);
      return { items };
    },
  } as unknown as k8s.CoreV1Api;
}

describe("createK8sSecretsStore", () => {
  it("write: creates ONE k8s Secret named 'psec-<kind>-<owner>' with {tenant,kind,owner} labels", async () => {
    const coreApi = fakeCoreApi();
    const store = createK8sSecretsStore(coreApi);

    const result = await store.write("acme", "hubspot-api-key", "value-1", {
      kind: "connector",
      owner: "hubspot",
    });
    expect(result.ok).toBe(true);

    const secretName = "acme-dev-ns/psec-connector-hubspot";
    const persisted = coreApi.secrets.get(secretName);
    expect(persisted).toBeDefined();
    expect(persisted?.metadata?.labels?.[SECRET_LABEL_KEYS.tenant]).toBe(
      "acme"
    );
    expect(persisted?.metadata?.labels?.[SECRET_LABEL_KEYS.kind]).toBe(
      "connector"
    );
    expect(persisted?.metadata?.labels?.[SECRET_LABEL_KEYS.owner]).toBe(
      "hubspot"
    );
  });

  it("write: a SECOND named secret for the SAME resource merges into the SAME k8s Secret (multi-key, one object per resource)", async () => {
    const coreApi = fakeCoreApi();
    const store = createK8sSecretsStore(coreApi);

    await store.write("acme", "api-key", "value-1", {
      kind: "connector",
      owner: "hubspot",
    });
    await store.write("acme", "api-secret", "value-2", {
      kind: "connector",
      owner: "hubspot",
    });

    const secretName = "acme-dev-ns/psec-connector-hubspot";
    const persisted = coreApi.secrets.get(secretName);
    const dataKeys = Object.keys(
      (persisted?.data as Record<string, string>) ?? {}
    );
    expect(dataKeys.sort()).toEqual(["api-key", "api-secret"]);
  });

  it("readResourceSecret: returns null when no Secret exists yet for the resource", async () => {
    const coreApi = fakeCoreApi();
    const store = createK8sSecretsStore(coreApi);

    const result = await store.readResourceSecret("acme", "agent", "bot-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });

  it("readResourceSecret: returns the full decoded key/value map", async () => {
    const coreApi = fakeCoreApi();
    const store = createK8sSecretsStore(coreApi);
    await store.write("acme", "token", SECRET_TOKEN, {
      kind: "channel",
      owner: "http-in",
    });

    const result = await store.readResourceSecret("acme", "channel", "http-in");
    expect(result.ok).toBe(true);
    if (result.ok && result.value) {
      expect(result.value.get("token")).toBe(SECRET_TOKEN);
    }
  });

  it("list: returns NAMES + BINDINGS only — never a value", async () => {
    const coreApi = fakeCoreApi();
    const store = createK8sSecretsStore(coreApi);
    await store.write("acme", "hubspot-api-key", SECRET_TOKEN, {
      kind: "connector",
      owner: "hubspot",
    });

    const result = await store.list("acme");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([
        {
          name: "hubspot-api-key",
          scope: { kind: "connector", owner: "hubspot" },
        },
      ]);
      // Never a value anywhere in the listing.
      expect(JSON.stringify(result.value)).not.toContain(SECRET_TOKEN);
    }
  });

  describe("value-never-logged", () => {
    let capturedStdout: string[];
    let originalWrite: typeof process.stdout.write;

    beforeEach(() => {
      capturedStdout = [];
      originalWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = ((chunk: string | Uint8Array) => {
        capturedStdout.push(chunk.toString());
        return true;
      }) as typeof process.stdout.write;
    });

    afterEach(() => {
      process.stdout.write = originalWrite;
    });

    it("write() never emits the secret value to the logger", async () => {
      const coreApi = fakeCoreApi();
      const store = createK8sSecretsStore(coreApi);

      await store.write("acme", "hubspot-api-key", SECRET_TOKEN, {
        kind: "connector",
        owner: "hubspot",
      });

      const allOutput = capturedStdout.join("\n");
      expect(allOutput).not.toContain(SECRET_TOKEN);
    });

    it("readResourceSecret() never emits the secret value to the logger", async () => {
      const coreApi = fakeCoreApi();
      const store = createK8sSecretsStore(coreApi);
      await store.write("acme", "token", SECRET_TOKEN, {
        kind: "channel",
        owner: "http-in",
      });
      capturedStdout = [];

      await store.readResourceSecret("acme", "channel", "http-in");

      const allOutput = capturedStdout.join("\n");
      expect(allOutput).not.toContain(SECRET_TOKEN);
    });

    it("deleteKey() never emits the secret value to the logger", async () => {
      const coreApi = fakeCoreApi();
      const store = createK8sSecretsStore(coreApi);
      await store.write("acme", "token", SECRET_TOKEN, {
        kind: "channel",
        owner: "http-in",
      });
      capturedStdout = [];

      await store.deleteKey("acme", "token", {
        kind: "channel",
        owner: "http-in",
      });

      const allOutput = capturedStdout.join("\n");
      expect(allOutput).not.toContain(SECRET_TOKEN);
    });
  });
});

// PENDIENTES/12-undeploy.spec.md T01 item 4 — the delete primitive undeploy
// needs (decision 2: secrets die with the manifest).
describe("createK8sSecretsStore — deleteKey", () => {
  it("removes ONE key and keeps the other keys bound to the same resource", async () => {
    const coreApi = fakeCoreApi();
    const store = createK8sSecretsStore(coreApi);
    await store.write("acme", "api-key", "v1", {
      kind: "connector",
      owner: "hubspot",
    });
    await store.write("acme", "api-secret", "v2", {
      kind: "connector",
      owner: "hubspot",
    });

    const result = await store.deleteKey("acme", "api-key", {
      kind: "connector",
      owner: "hubspot",
    });

    expect(result).toEqual({ ok: true, value: { deleted: true } });
    const persisted = coreApi.secrets.get("acme-dev-ns/psec-connector-hubspot");
    expect(Object.keys(persisted?.data ?? {})).toEqual(["api-secret"]);
  });

  it("deletes the whole k8s Secret once its LAST key is removed", async () => {
    const coreApi = fakeCoreApi();
    const store = createK8sSecretsStore(coreApi);
    await store.write("acme", "token", "v1", {
      kind: "channel",
      owner: "http-in",
    });

    const result = await store.deleteKey("acme", "token", {
      kind: "channel",
      owner: "http-in",
    });

    expect(result).toEqual({ ok: true, value: { deleted: true } });
    expect(coreApi.secrets.has("acme-dev-ns/psec-channel-http-in")).toBe(false);
  });

  it("is idempotent: deleting an absent Secret returns deleted:false, never an error", async () => {
    const store = createK8sSecretsStore(fakeCoreApi());

    const result = await store.deleteKey("acme", "token", {
      kind: "channel",
      owner: "http-in",
    });

    expect(result).toEqual({ ok: true, value: { deleted: false } });
  });

  it("is idempotent: deleting an absent KEY of an existing Secret returns deleted:false", async () => {
    const coreApi = fakeCoreApi();
    const store = createK8sSecretsStore(coreApi);
    await store.write("acme", "api-key", "v1", {
      kind: "connector",
      owner: "hubspot",
    });

    const result = await store.deleteKey("acme", "other-key", {
      kind: "connector",
      owner: "hubspot",
    });

    expect(result).toEqual({ ok: true, value: { deleted: false } });
    expect(coreApi.secrets.has("acme-dev-ns/psec-connector-hubspot")).toBe(
      true
    );
  });

  it("surfaces a k8s failure as a typed downstream_error", async () => {
    const coreApi = fakeCoreApi();
    const store = createK8sSecretsStore(coreApi);
    await store.write("acme", "token", "v1", {
      kind: "channel",
      owner: "http-in",
    });
    (
      coreApi as unknown as { deleteNamespacedSecret: () => Promise<never> }
    ).deleteNamespacedSecret = async () => {
      throw new Error("apiserver exploded");
    };

    const result = await store.deleteKey("acme", "token", {
      kind: "channel",
      owner: "http-in",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.kind).toBe("downstream_error");
    expect(result.error.message).toContain("apiserver exploded");
  });
});
