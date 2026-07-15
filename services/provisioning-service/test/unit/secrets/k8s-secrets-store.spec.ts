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
  });
});
