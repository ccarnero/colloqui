import { computed, inject, Injectable, signal } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Router } from "@angular/router";
import type { Observable } from "rxjs";
import type { IAuthContext } from "./auth-context";
import { SYSTEM_ROLE_TENANT_ADMIN } from "./auth-constants";
import type { IJwtPayload, ITokenResponse, IUserProfile, LoginTenantMode } from "./auth-types";
import { decodeJwtPayload, extractInitials, formatRole } from "./auth-utils";

/**
 * Shared JWT/session logic: storage keys and login tenant mode are defined by subclasses.
 */
@Injectable()
export abstract class BaseAuthService implements IAuthContext {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly token = signal<string | null>(null);

  /**
   * Call from the concrete service constructor after `super()` to hydrate the token
   * from localStorage (abstract storage keys are not available in the base ctor).
   */
  protected restoreTokenFromStorage(): void {
    this.token.set(localStorage.getItem(this.tokenStorageKey));
  }

  /** API origin (e.g. environment.apiUrl) without trailing slash handling — apps must normalize. */
  protected abstract get apiBaseUrl(): string;

  protected abstract get tokenStorageKey(): string;

  protected abstract get refreshStorageKey(): string;

  /** Admin console sends `tenant_id` in body; messaging uses `x-yoizen-tenant`. */
  protected abstract get loginTenantMode(): LoginTenantMode;

  /** Hook after access (and optional refresh) tokens are persisted — e.g. schedule proactive refresh. */
  protected onAfterSetTokens(_accessToken: string, _refreshToken?: string): void {
    /* default: no-op */
  }

  /** Hook before clearing storage — e.g. clear refresh timers. */
  protected onBeforeLogout(): void {
    /* default: no-op */
  }

  protected readonly jwtPayload = computed<IJwtPayload | null>(() => {
    const t = this.token();
    return t ? decodeJwtPayload(t) : null;
  });

  readonly isAuthenticated = computed(() => {
    const payload = this.jwtPayload();
    if (!payload) return false;
    return payload.exp * 1000 > Date.now();
  });

  readonly tenantId = computed<string | null>(() => {
    const payload = this.jwtPayload();
    if (!payload) return null;
    if (payload.tenant_id) return payload.tenant_id;
    const { scope } = payload;
    if (scope.startsWith("tenant:")) return scope.slice(7);
    return null;
  });

  readonly userRole = computed<string>(() => {
    const payload = this.jwtPayload();
    return payload?.role ?? "viewer";
  });

  readonly permissions = computed<Set<string>>(() => {
    const payload = this.jwtPayload();
    const perms = payload?.permissions;
    return new Set(perms ?? []);
  });

  readonly isAdmin = computed(() => {
    const role = this.userRole();
    if (role === SYSTEM_ROLE_TENANT_ADMIN) return true;
    return this.permissions().has("*");
  });

  readonly userProfile = computed<IUserProfile>(() => {
    const payload = this.jwtPayload();
    const email = payload?.email ?? "unknown";
    return {
      id: payload?.sub ?? "",
      name: payload?.email ?? "User",
      email,
      initials: extractInitials(email),
      role: formatRole(payload?.role ?? "viewer"),
    };
  });

  hasPermission(permission: string): boolean {
    if (this.isAdmin()) return true;
    return this.permissions().has(permission);
  }

  login(email: string, password: string, tenantId?: string): void {
    this.postLogin(email, password, tenantId).subscribe({
      next: (res) => {
        this.completeLogin(res);
      },
      error: () => {
        /* caller may handle via loginWithResult observable */
      },
    });
  }

  /**
   * Observable login for UI that needs to show errors (e.g. messaging console).
   */
  protected postLogin(
    email: string,
    password: string,
    tenantId?: string,
  ): Observable<ITokenResponse> {
    const body: Record<string, string> = { email, password };
    const headers: Record<string, string> = {};
    if (tenantId) {
      if (this.loginTenantMode === "body") {
        body["tenant_id"] = tenantId;
      } else {
        headers["x-yoizen-tenant"] = tenantId;
      }
    }
    return this.http.post<ITokenResponse>(
      `${this.apiBaseUrl}/auth/login`,
      body,
      { headers },
    );
  }

  protected completeLogin(res: ITokenResponse): void {
    this.setTokens(res.access_token, res.refresh_token);
    void this.router.navigate(["/"]);
  }

  logout(): void {
    this.onBeforeLogout();
    localStorage.removeItem(this.tokenStorageKey);
    localStorage.removeItem(this.refreshStorageKey);
    this.token.set(null);
    void this.router.navigate(["/login"]);
  }

  refreshToken(): void {
    const refresh = localStorage.getItem(this.refreshStorageKey);
    if (!refresh) {
      this.logout();
      return;
    }

    this.http
      .post<ITokenResponse>(`${this.apiBaseUrl}/auth/refresh`, {
        refresh_token: refresh,
      })
      .subscribe({
        next: (res) => {
          this.setTokens(res.access_token, res.refresh_token);
        },
        error: () => {
          this.logout();
        },
      });
  }

  protected setTokens(accessToken: string, refreshToken?: string): void {
    localStorage.setItem(this.tokenStorageKey, accessToken);
    this.token.set(accessToken);
    if (refreshToken) {
      localStorage.setItem(this.refreshStorageKey, refreshToken);
    }
    this.onAfterSetTokens(accessToken, refreshToken);
  }
}
