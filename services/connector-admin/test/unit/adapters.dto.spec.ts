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
