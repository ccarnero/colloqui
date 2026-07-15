import "../../setup-env";
import { describe, expect, it } from "bun:test";
import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { TenantGuard } from "@yoizen/database";
import { SecretsBrokerController } from "../../../src/modules/secrets/broker/secrets-broker.controller";
import { SecretsController } from "../../../src/modules/secrets/secrets.controller";

describe("SecretsController tenant isolation guard", () => {
  it("is decorated with @UseGuards(TenantGuard)", () => {
    const guards = Reflect.getMetadata("__guards__", SecretsController) as
      | unknown[]
      | undefined;
    expect(guards).toBeDefined();
    expect(guards?.some((guard) => guard === TenantGuard)).toBe(true);
  });

  it("rejects a request with no x-yoizen-tenant header", () => {
    const guard = new TenantGuard();
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
    } as unknown as Parameters<TenantGuard["canActivate"]>[0];
    expect(() => guard.canActivate(context)).toThrow(BadRequestException);
  });
});

describe("SecretsBrokerController tenant isolation guard", () => {
  it("is decorated with @UseGuards(TenantGuard) — internal-only is ADDITIONAL to tenant scoping, not a replacement", () => {
    const guards = Reflect.getMetadata("__guards__", SecretsBrokerController) as
      | unknown[]
      | undefined;
    expect(guards).toBeDefined();
    expect(guards?.some((guard) => guard === TenantGuard)).toBe(true);
  });
});
