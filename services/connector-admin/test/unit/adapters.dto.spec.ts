import "reflect-metadata";
import { describe, expect, it } from "bun:test";
import {
  ADAPTER_MAX_RETRIES_MAX,
  ADAPTER_RETRY_BACKOFF_MS_MAX,
  ADAPTER_TIMEOUT_MS_MAX,
} from "@yoizen/shared";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  CreateAdapterDto,
  UpdateAdapterDto,
} from "../../src/modules/adapters/adapters.dto";

// manual-loops/architecture/system-validation.md T01 — the adapter
// resilience knobs had a `@Min` but NO upper bound, so an operator could
// persist `timeoutMs: 3_600_000` and hold an upstream caller hostage.
// Caps live in `@yoizen/shared` (decision 3) and are enforced here.

const CREATE_BASE = {
  name: "adapter-under-test",
  context: "external",
  baseUrl: "https://example.internal/api",
};

async function failedProperties(
  dto: CreateAdapterDto | UpdateAdapterDto
): Promise<string[]> {
  const errors = await validate(dto);
  return errors.map((error) => error.property);
}

describe("CreateAdapterDto resilience caps", () => {
  const cases = [
    { field: "timeoutMs", cap: ADAPTER_TIMEOUT_MS_MAX },
    { field: "maxRetries", cap: ADAPTER_MAX_RETRIES_MAX },
    { field: "retryBackoffMs", cap: ADAPTER_RETRY_BACKOFF_MS_MAX },
  ] as const;

  for (const { field, cap } of cases) {
    it(`accepts ${field} exactly at the cap (${cap})`, async () => {
      const dto = plainToInstance(CreateAdapterDto, {
        ...CREATE_BASE,
        [field]: cap,
      });
      expect(await failedProperties(dto)).toHaveLength(0);
    });

    it(`rejects ${field} above the cap (${cap + 1})`, async () => {
      const dto = plainToInstance(CreateAdapterDto, {
        ...CREATE_BASE,
        [field]: cap + 1,
      });
      const errors = await validate(dto);
      expect(errors.map((error) => error.property)).toContain(field);
      expect(
        errors.find((error) => error.property === field)?.constraints
      ).toHaveProperty("max");
    });
  }
});

describe("UpdateAdapterDto resilience caps", () => {
  const cases = [
    { field: "timeoutMs", cap: ADAPTER_TIMEOUT_MS_MAX },
    { field: "maxRetries", cap: ADAPTER_MAX_RETRIES_MAX },
    { field: "retryBackoffMs", cap: ADAPTER_RETRY_BACKOFF_MS_MAX },
  ] as const;

  for (const { field, cap } of cases) {
    it(`accepts ${field} exactly at the cap (${cap})`, async () => {
      const dto = plainToInstance(UpdateAdapterDto, { [field]: cap });
      expect(await failedProperties(dto)).toHaveLength(0);
    });

    it(`rejects ${field} above the cap (${cap + 1})`, async () => {
      const dto = plainToInstance(UpdateAdapterDto, { [field]: cap + 1 });
      const errors = await validate(dto);
      expect(errors.map((error) => error.property)).toContain(field);
      expect(
        errors.find((error) => error.property === field)?.constraints
      ).toHaveProperty("max");
    });
  }
});

// PENDIENTES/01-bugs-group-b.spec.md T01 (E11) — `oauth2-client` was an
// accepted `authType` that no injector could ever honour, so such connectors
// silently sent no `Authorization`. The value is gone from the whitelist:
// the four surviving types stay accepted, `oauth2-client` is now rejected.
describe("adapter authType whitelist", () => {
  const supported = ["none", "api-key", "bearer", "basic"] as const;

  for (const authType of supported) {
    it(`accepts authType '${authType}' on create`, async () => {
      const dto = plainToInstance(CreateAdapterDto, {
        ...CREATE_BASE,
        authType,
      });
      expect(await failedProperties(dto)).toHaveLength(0);
    });

    it(`accepts authType '${authType}' on update`, async () => {
      const dto = plainToInstance(UpdateAdapterDto, { authType });
      expect(await failedProperties(dto)).toHaveLength(0);
    });
  }

  it("rejects the removed 'oauth2-client' authType on create", async () => {
    const dto = plainToInstance(CreateAdapterDto, {
      ...CREATE_BASE,
      authType: "oauth2-client",
    });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toContain("authType");
    expect(
      errors.find((error) => error.property === "authType")?.constraints
    ).toHaveProperty("isIn");
  });

  it("rejects the removed 'oauth2-client' authType on update", async () => {
    const dto = plainToInstance(UpdateAdapterDto, {
      authType: "oauth2-client",
    });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toContain("authType");
    expect(
      errors.find((error) => error.property === "authType")?.constraints
    ).toHaveProperty("isIn");
  });
});
