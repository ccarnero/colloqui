import "../../setup-env";
import { describe, expect, it } from "bun:test";
import "reflect-metadata";
import { RequestMethod } from "@nestjs/common";
import { TenantGuard } from "@yoizen/database";
import { UndeployController } from "../../../src/modules/undeploy/undeploy.controller";

// Same shape as `apply/apply-tenant-guard.spec.ts` (and the plan/manifests/
// secrets siblings): every controller of this service must be tenant-scoped.
// The route-metadata assertions below additionally PIN the public path —
// `POST /manifests/:name/undeploy` — because it is the contract T02's
// api-gateway proxy and the SDK client are written against, and a typo there
// would otherwise only surface live.
describe("UndeployController tenant isolation guard", () => {
  it("is decorated with @UseGuards(TenantGuard) — same guard as ApplyController", () => {
    const guards = Reflect.getMetadata("__guards__", UndeployController) as
      | unknown[]
      | undefined;
    expect(guards).toBeDefined();
    expect(guards?.some((guard) => guard === TenantGuard)).toBe(true);
  });

  it("exposes exactly POST manifests/:name/undeploy", () => {
    expect(Reflect.getMetadata("path", UndeployController)).toBe("manifests");
    expect(
      Reflect.getMetadata("path", UndeployController.prototype.undeploy)
    ).toBe(":name/undeploy");
    expect(
      Reflect.getMetadata("method", UndeployController.prototype.undeploy)
    ).toBe(RequestMethod.POST);
  });
});
