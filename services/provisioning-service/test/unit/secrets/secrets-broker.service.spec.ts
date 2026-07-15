import "../../setup-env";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { SecretsBrokerService } from "../../../src/modules/secrets/broker/secrets-broker.service";
import { NOOP_SECRET_AUDIT_PUBLISHER } from "../../../src/modules/secrets/domain/secret-audit-publisher.interface";
import type { ISecretsStore } from "../../../src/modules/secrets/domain/secrets-store.interface";

const SECRET_TOKEN = "sk-broker-secret-VALUE-marker-1a2b3c";

function storeWithBinding(
  map: Map<string, Map<string, string>>
): ISecretsStore {
  return {
    async write() {
      return { ok: true };
    },
    async list() {
      return { ok: true, value: [] };
    },
    async readResourceSecret(_tenantId, kind, owner) {
      const key = `${kind}/${owner}`;
      return { ok: true, value: map.get(key) ?? null };
    },
  };
}

describe("SecretsBrokerService — binding enforcement", () => {
  it("resolves the value when the acting resource matches the bound scope", async () => {
    const map = new Map([
      ["connector/hubspot", new Map([["hubspot-api-key", SECRET_TOKEN]])],
    ]);
    const broker = new SecretsBrokerService(
      storeWithBinding(map),
      NOOP_SECRET_AUDIT_PUBLISHER
    );

    const result = await broker.resolve({
      tenantId: "acme",
      consumerService: "provisioning-service-apply-engine",
      secretName: "hubspot-api-key",
      actingResource: { kind: "connector", owner: "hubspot" },
      correlationId: "run-1",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.value).toBe(SECRET_TOKEN);
    }
  });

  it("denies + audits a WRONG consumer BEFORE any secret read (consumer_unauthorized)", async () => {
    // The secret IS bound and the (kind, owner, secretName) would match —
    // but `agent-ai-service` is not authorized to resolve CONNECTOR secrets,
    // so the broker must deny before ever reading the value.
    const map = new Map([
      ["connector/hubspot", new Map([["hubspot-api-key", SECRET_TOKEN]])],
    ]);
    let readCalled = false;
    const store: ISecretsStore = {
      async write() {
        return { ok: true };
      },
      async list() {
        return { ok: true, value: [] };
      },
      async readResourceSecret(_tenantId, kind, owner) {
        readCalled = true;
        return { ok: true, value: map.get(`${kind}/${owner}`) ?? null };
      },
    };
    let denied: unknown;
    const audit = {
      ...NOOP_SECRET_AUDIT_PUBLISHER,
      async secretAccessDenied(event: unknown) {
        denied = event;
      },
    };
    const broker = new SecretsBrokerService(store, audit);

    const result = await broker.resolve({
      tenantId: "acme",
      consumerService: "agent-ai-service",
      secretName: "hubspot-api-key",
      actingResource: { kind: "connector", owner: "hubspot" },
      correlationId: "run-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("consumer_unauthorized");
    }
    // The unauthorized consumer never triggered a credential read.
    expect(readCalled).toBe(false);
    expect(denied).toMatchObject({
      consumerService: "agent-ai-service",
      kind: "connector",
      owner: "hubspot",
    });
    expect(JSON.stringify(denied)).not.toContain(SECRET_TOKEN);
  });

  it("denies + audits an empty/unknown consumer identity (consumer_unauthorized)", async () => {
    const map = new Map([
      ["connector/hubspot", new Map([["hubspot-api-key", SECRET_TOKEN]])],
    ]);
    const broker = new SecretsBrokerService(
      storeWithBinding(map),
      NOOP_SECRET_AUDIT_PUBLISHER
    );

    const result = await broker.resolve({
      tenantId: "acme",
      consumerService: "some-random-unlisted-service",
      secretName: "hubspot-api-key",
      actingResource: { kind: "connector", owner: "hubspot" },
      correlationId: "run-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("consumer_unauthorized");
    }
  });

  it("allows a kind-scoped runtime consumer to resolve its OWN kind (channel-service → channel secrets)", async () => {
    const map = new Map([
      ["channel/http-in", new Map([["token", SECRET_TOKEN]])],
    ]);
    const broker = new SecretsBrokerService(
      storeWithBinding(map),
      NOOP_SECRET_AUDIT_PUBLISHER
    );

    const result = await broker.resolve({
      tenantId: "acme",
      consumerService: "channel-service",
      secretName: "token",
      actingResource: { kind: "channel", owner: "http-in" },
      correlationId: "run-1",
    });

    expect(result.ok).toBe(true);
  });

  it("denies a kind-scoped runtime consumer acting for a DIFFERENT kind (channel-service → connector secrets)", async () => {
    const map = new Map([
      ["connector/hubspot", new Map([["hubspot-api-key", SECRET_TOKEN]])],
    ]);
    const broker = new SecretsBrokerService(
      storeWithBinding(map),
      NOOP_SECRET_AUDIT_PUBLISHER
    );

    const result = await broker.resolve({
      tenantId: "acme",
      consumerService: "channel-service",
      secretName: "hubspot-api-key",
      actingResource: { kind: "connector", owner: "hubspot" },
      correlationId: "run-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("consumer_unauthorized");
    }
  });

  it("denies + audits when no secret is bound to the resource at all (not_found)", async () => {
    const map = new Map<string, Map<string, string>>();
    let denied: unknown;
    const audit = {
      ...NOOP_SECRET_AUDIT_PUBLISHER,
      async secretAccessDenied(event: unknown) {
        denied = event;
      },
    };
    const broker = new SecretsBrokerService(storeWithBinding(map), audit);

    const result = await broker.resolve({
      tenantId: "acme",
      consumerService: "provisioning-service-apply-engine",
      secretName: "hubspot-api-key",
      actingResource: { kind: "connector", owner: "hubspot" },
      correlationId: "run-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("not_found");
    }
    expect(denied).toMatchObject({
      tenantId: "acme",
      secretName: "hubspot-api-key",
      kind: "connector",
      owner: "hubspot",
    });
  });

  it("denies + audits when the caller presents a WRONG owner (binding mismatch)", async () => {
    // The secret is really bound to connector/hubspot; a caller claiming to
    // act for connector/other-connector gets a DIFFERENT resource's Secret
    // (or none), so the requested key is never found there.
    const map = new Map([
      ["connector/hubspot", new Map([["hubspot-api-key", SECRET_TOKEN]])],
    ]);
    let denied: unknown;
    const audit = {
      ...NOOP_SECRET_AUDIT_PUBLISHER,
      async secretAccessDenied(event: unknown) {
        denied = event;
      },
    };
    const broker = new SecretsBrokerService(storeWithBinding(map), audit);

    const result = await broker.resolve({
      tenantId: "acme",
      consumerService: "provisioning-service-apply-engine",
      secretName: "hubspot-api-key",
      actingResource: { kind: "connector", owner: "other-connector" },
      correlationId: "run-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("not_found");
    }
    expect(denied).toMatchObject({ owner: "other-connector" });
  });

  it("denies + audits when the caller presents the RIGHT resource but the WRONG secret name (binding mismatch)", async () => {
    const map = new Map([
      ["connector/hubspot", new Map([["hubspot-api-key", SECRET_TOKEN]])],
    ]);
    let denied: unknown;
    const audit = {
      ...NOOP_SECRET_AUDIT_PUBLISHER,
      async secretAccessDenied(event: unknown) {
        denied = event;
      },
    };
    const broker = new SecretsBrokerService(storeWithBinding(map), audit);

    const result = await broker.resolve({
      tenantId: "acme",
      consumerService: "provisioning-service-apply-engine",
      secretName: "unrelated-secret-name",
      actingResource: { kind: "connector", owner: "hubspot" },
      correlationId: "run-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("binding_mismatch");
    }
    expect(denied).toMatchObject({
      secretName: "unrelated-secret-name",
      kind: "connector",
      owner: "hubspot",
    });
  });

  it("denies + audits when the caller presents the WRONG kind for the same owner name", async () => {
    const map = new Map([
      ["connector/hubspot", new Map([["hubspot-api-key", SECRET_TOKEN]])],
    ]);
    const broker = new SecretsBrokerService(
      storeWithBinding(map),
      NOOP_SECRET_AUDIT_PUBLISHER
    );

    const result = await broker.resolve({
      tenantId: "acme",
      consumerService: "provisioning-service-apply-engine",
      secretName: "hubspot-api-key",
      actingResource: { kind: "agent", owner: "hubspot" },
      correlationId: "run-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("not_found");
    }
  });

  it("never includes the resolved value in a denial payload", async () => {
    const map = new Map([
      ["connector/hubspot", new Map([["hubspot-api-key", SECRET_TOKEN]])],
    ]);
    let denied: unknown;
    const audit = {
      ...NOOP_SECRET_AUDIT_PUBLISHER,
      async secretAccessDenied(event: unknown) {
        denied = event;
      },
    };
    const broker = new SecretsBrokerService(storeWithBinding(map), audit);

    await broker.resolve({
      tenantId: "acme",
      consumerService: "provisioning-service-apply-engine",
      secretName: "unrelated-secret-name",
      actingResource: { kind: "connector", owner: "hubspot" },
      correlationId: "run-1",
    });

    expect(JSON.stringify(denied)).not.toContain(SECRET_TOKEN);
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

    it("a successful resolve never logs the value", async () => {
      const map = new Map([
        ["connector/hubspot", new Map([["hubspot-api-key", SECRET_TOKEN]])],
      ]);
      const broker = new SecretsBrokerService(
        storeWithBinding(map),
        NOOP_SECRET_AUDIT_PUBLISHER
      );

      await broker.resolve({
        tenantId: "acme",
        consumerService: "provisioning-service-apply-engine",
        secretName: "hubspot-api-key",
        actingResource: { kind: "connector", owner: "hubspot" },
        correlationId: "run-1",
      });

      const allOutput = capturedStdout.join("\n");
      expect(allOutput).not.toContain(SECRET_TOKEN);
    });
  });
});
