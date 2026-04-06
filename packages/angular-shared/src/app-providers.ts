import type { EnvironmentProviders, Provider } from "@angular/core";
import { provideBrowserGlobalErrorListeners } from "@angular/core";
import type { Type } from "@angular/core";
import { provideRouter, withComponentInputBinding, type Routes } from "@angular/router";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { provideAnimationsAsync } from "@angular/platform-browser/animations/async";
import { AUTH_CONTEXT, type IAuthContext } from "./auth-context";
import { authInterceptor } from "./auth.interceptor";
import { tenantInterceptor } from "./tenant.interceptor";

/**
 * Shared Angular bootstrap providers for Yoizen console apps (router, HTTP,
 * auth/tenant interceptors, animations).
 */
export function provideCoreApp(options: {
  routes: Routes;
  authServiceClass: Type<IAuthContext>;
}): Array<Provider | EnvironmentProviders> {
  return [
    provideBrowserGlobalErrorListeners(),
    { provide: AUTH_CONTEXT, useExisting: options.authServiceClass },
    provideRouter(options.routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([authInterceptor, tenantInterceptor])),
    provideAnimationsAsync(),
  ];
}
