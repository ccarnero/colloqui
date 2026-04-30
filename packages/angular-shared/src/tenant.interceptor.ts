import { HttpInterceptorFn } from "@angular/common/http";
import { inject } from "@angular/core";
import { AUTH_CONTEXT } from "./auth-context";

export const tenantInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AUTH_CONTEXT);
  const tenantId = auth.tenantId();

  if (tenantId) {
    const cloned = req.clone({
      setHeaders: { "x-yoizen-tenant": tenantId },
    });
    return next(cloned);
  }

  return next(req);
};
