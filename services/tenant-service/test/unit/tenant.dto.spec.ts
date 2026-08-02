import "../setup-env";
import { describe, expect, it } from "bun:test";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import {
  CreateTenantDto,
  UpdateTenantDto,
} from "../../src/modules/tenants/tenant.dto";

/**
 * tenant-messaging-tiers T01 acceptance: an invalid `messagingTier` is
 * rejected with 400. The global ValidationPipe enforces these decorators at
 * the HTTP boundary (bootstrap-fastify.ts); this spec exercises the same
 * class-validator metadata directly, so the pin holds without booting Nest.
 */
describe("Tenant DTO validation (messagingTier)", () => {
  it("CreateTenantDto rejects an unknown messagingTier", () => {
    const dto = plainToInstance(CreateTenantDto, {
      name: "acme",
      messagingTier: "gold",
    });
    const errors = validateSync(dto);
    expect(errors.some((e) => e.property === "messagingTier")).toBe(true);
  });

  it("CreateTenantDto accepts each valid tier and none at all", () => {
    for (const tier of ["free", "pro", "enterprise", undefined]) {
      const dto = plainToInstance(CreateTenantDto, {
        name: "acme",
        ...(tier === undefined ? {} : { messagingTier: tier }),
      });
      expect(validateSync(dto)).toHaveLength(0);
    }
  });

  it("UpdateTenantDto rejects an unknown messagingTier", () => {
    const dto = plainToInstance(UpdateTenantDto, { messagingTier: "gold" });
    const errors = validateSync(dto);
    expect(errors.some((e) => e.property === "messagingTier")).toBe(true);
  });

  it("UpdateTenantDto accepts a tier-only body and a configuration-only body", () => {
    expect(
      validateSync(plainToInstance(UpdateTenantDto, { messagingTier: "pro" }))
    ).toHaveLength(0);
    expect(
      validateSync(
        plainToInstance(UpdateTenantDto, { configuration: { a: 1 } })
      )
    ).toHaveLength(0);
    // An empty body passes DTO validation by design — the SERVICE rejects it
    // with 400 (asserted in tenants.service.spec.ts).
    expect(validateSync(plainToInstance(UpdateTenantDto, {}))).toHaveLength(0);
  });
});
