import "../../setup-env";
import { describe, expect, it } from "bun:test";
import "reflect-metadata";
import { TenantGuard } from "@yoizen/database";
import { PlanController } from "../../../src/modules/plan/plan.controller";

describe("PlanController tenant isolation guard", () => {
  it("is decorated with @UseGuards(TenantGuard) — same guard as ManifestsController", () => {
    const guards = Reflect.getMetadata("__guards__", PlanController) as
      | unknown[]
      | undefined;
    expect(guards).toBeDefined();
    expect(guards?.some((guard) => guard === TenantGuard)).toBe(true);
  });
});
