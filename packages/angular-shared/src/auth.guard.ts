import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";
import { AUTH_CONTEXT } from "./auth-context";

export const authGuard: CanActivateFn = () => {
  const auth = inject(AUTH_CONTEXT);
  const router = inject(Router);

  if (auth.isAuthenticated()) {
    return true;
  }

  return router.createUrlTree(["/login"]);
};
