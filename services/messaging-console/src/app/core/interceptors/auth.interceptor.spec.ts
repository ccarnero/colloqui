import { AuthInterceptor } from "./auth.interceptor";

describe("AuthInterceptor", () => {
  it("re-exports the shared HttpInterceptorFn from @yoizen/angular-shared", () => {
    expect(AuthInterceptor).toBeDefined();
    expect(typeof AuthInterceptor).toBe("function");
  });
});
