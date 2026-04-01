import { HttpInterceptorFn } from "@angular/common/http";
import { inject } from "@angular/core";
import { AUTH_CONTEXT } from "./auth-context";

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AUTH_CONTEXT);
  const token = auth.token();

  if (token) {
    const cloned = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` },
    });
    return next(cloned);
  }

  return next(req);
};
