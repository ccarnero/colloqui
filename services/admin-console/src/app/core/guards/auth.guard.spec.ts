import { authGuard } from "./auth.guard";

describe("authGuard", () => {
  it("re-exports the shared CanActivateFn from @yoizen/angular-shared", () => {
    expect(authGuard).toBeDefined();
    expect(typeof authGuard).toBe("function");
  });
});
