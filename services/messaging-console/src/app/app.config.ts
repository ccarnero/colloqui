import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
} from "@angular/core";
import { provideRouter, withComponentInputBinding } from "@angular/router";
import {
  type HttpInterceptorFn,
  provideHttpClient,
  withInterceptors,
} from "@angular/common/http";
import { provideAnimationsAsync } from "@angular/platform-browser/animations/async";

import { AUTH_CONTEXT } from "@yoizen/angular-shared";
import { routes } from "./app.routes";
import { AuthInterceptor } from "./core/interceptors/auth.interceptor";
import { TenantInterceptor } from "./core/interceptors/tenant.interceptor";
import { AuthService } from "./core/services/auth.service";

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: AUTH_CONTEXT, useExisting: AuthService },
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(
      withInterceptors([
        AuthInterceptor as unknown as HttpInterceptorFn,
        TenantInterceptor as unknown as HttpInterceptorFn,
      ]),
    ),
    provideAnimationsAsync(),
  ],
};
