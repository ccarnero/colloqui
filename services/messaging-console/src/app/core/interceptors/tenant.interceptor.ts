import { HttpInterceptorFn } from "@angular/common/http";
import { inject } from "@angular/core";
import { AuthService } from "../services/auth.service";

export const tenantInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const tenantId = authService.tenantId();

  if (tenantId) {
    const cloned = req.clone({
      setHeaders: { "x-yoizen-tenant": tenantId },
    });
    return next(cloned);
  }

  return next(req);
};
