import "../../setup-env";
import { describe, expect, it } from "bun:test";
import { HttpException } from "@nestjs/common";
import { NOOP_SECRET_AUDIT_PUBLISHER } from "../../../src/modules/secrets/domain/secret-audit-publisher.interface";
import type { ISecretsStore } from "../../../src/modules/secrets/domain/secrets-store.interface";
import { SecretsController } from "../../../src/modules/secrets/secrets.controller";
import { SecretsService } from "../../../src/modules/secrets/secrets.service";

function fakeStore(): ISecretsStore {
  const written: {
    name: string;
    value: string;
    scope: { kind: string; owner: string };
  }[] = [];
  return {
    async write(_tenantId, name, value, scope) {
      written.push({ name, value, scope });
      return { ok: true };
    },
    async list() {
      return {
        ok: true,
        value: written.map((w) => ({ name: w.name, scope: w.scope })),
      };
    },
    async readResourceSecret() {
      return { ok: true, value: null };
    },
  } as unknown as ISecretsStore;
}

describe("SecretsController — write-only guarantee", () => {
  it("PUT /secrets/:name never returns the value it received", async () => {
    const service = new SecretsService(
      fakeStore(),
      NOOP_SECRET_AUDIT_PUBLISHER
    );
    const controller = new SecretsController(service);

    const response = await controller.put("acme", "hubspot-api-key", {
      value: "super-secret-value",
      scope: { kind: "connector", owner: "hubspot" },
    });

    expect(response).toEqual({
      name: "hubspot-api-key",
      scope: { kind: "connector", owner: "hubspot" },
    });
    expect(JSON.stringify(response)).not.toContain("super-secret-value");
  });

  it("GET /secrets lists names + bindings ONLY — no route ever returns a value", async () => {
    const service = new SecretsService(
      fakeStore(),
      NOOP_SECRET_AUDIT_PUBLISHER
    );
    const controller = new SecretsController(service);

    await controller.put("acme", "hubspot-api-key", {
      value: "super-secret-value",
      scope: { kind: "connector", owner: "hubspot" },
    });
    const listed = await controller.list("acme");

    expect(listed).toEqual({
      secrets: [
        {
          name: "hubspot-api-key",
          scope: { kind: "connector", owner: "hubspot" },
        },
      ],
    });
    expect(JSON.stringify(listed)).not.toContain("super-secret-value");
  });

  it("PUT /secrets/:name rejects a missing value with a typed 400", async () => {
    const service = new SecretsService(
      fakeStore(),
      NOOP_SECRET_AUDIT_PUBLISHER
    );
    const controller = new SecretsController(service);

    await expect(
      controller.put("acme", "hubspot-api-key", {
        scope: { kind: "connector", owner: "hubspot" },
      })
    ).rejects.toBeInstanceOf(HttpException);
  });

  it("PUT /secrets/:name rejects an invalid scope.kind", async () => {
    const service = new SecretsService(
      fakeStore(),
      NOOP_SECRET_AUDIT_PUBLISHER
    );
    const controller = new SecretsController(service);

    await expect(
      controller.put("acme", "hubspot-api-key", {
        value: "v",
        scope: { kind: "not-a-kind", owner: "hubspot" },
      })
    ).rejects.toBeInstanceOf(HttpException);
  });

  it("PUT /secrets/:name rejects a non-slug secret name", async () => {
    const service = new SecretsService(
      fakeStore(),
      NOOP_SECRET_AUDIT_PUBLISHER
    );
    const controller = new SecretsController(service);

    await expect(
      controller.put("acme", "Not A Slug!", {
        value: "v",
        scope: { kind: "connector", owner: "hubspot" },
      })
    ).rejects.toBeInstanceOf(HttpException);
  });
});
