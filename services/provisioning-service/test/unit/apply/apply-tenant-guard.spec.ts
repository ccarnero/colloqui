import "../../setup-env";
import { describe, expect, it } from "bun:test";
import "reflect-metadata";
import { TenantGuard } from "@yoizen/database";
import { ApplyController } from "../../../src/modules/apply/apply.controller";

describe("ApplyController tenant isolation guard", () => {
  it("is decorated with @UseGuards(TenantGuard) — same guard as PlanController/ManifestsController", () => {
    const guards = Reflect.getMetadata("__guards__", ApplyController) as
      | unknown[]
      | undefined;
    expect(guards).toBeDefined();
    expect(guards?.some((guard) => guard === TenantGuard)).toBe(true);
  });
});
