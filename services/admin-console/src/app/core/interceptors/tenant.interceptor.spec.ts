import { TenantInterceptor } from "./tenant.interceptor";

describe("TenantInterceptor", () => {
  it("re-exports the shared HttpInterceptorFn from @yoizen/angular-shared", () => {
    expect(TenantInterceptor).toBeDefined();
    expect(typeof TenantInterceptor).toBe("function");
  });
});
