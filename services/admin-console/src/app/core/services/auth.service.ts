import { Injectable, signal, computed, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Router } from "@angular/router";
import { environment } from "../../../environments/environment";

const SYSTEM_ROLE_TENANT_ADMIN = "tenant_admin";

interface ITokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
}

interface IJwtPayload {
  sub: string;
  type: string;
  scope: string;
  role?: string;
  permissions?: string[];
  tenant_id?: string;
  email?: string;
  env: string;
  iat: number;
  exp: number;
}

interface IUserProfile {
  id: string;
  name: string;
  email: string;
  initials: string;
  role: string;
}

const TOKEN_KEY = "admin-console-token";
const REFRESH_KEY = "admin-console-refresh";

function decodeJwtPayload(token: string): IJwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(payload) as IJwtPayload;
  } catch {
    return null;
  }
}

function extractInitials(email: string): string {
  const local = email.split("@")[0] ?? "";
  const segments = local.split(/[._-]/).filter(Boolean);
  if (segments.length >= 2) {
    return (segments[0][0] + segments[1][0]).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

function formatRole(role: string): string {
  return role
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

@Injectable({ providedIn: "root" })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly token = signal<string | null>(localStorage.getItem(TOKEN_KEY));

  private readonly jwtPayload = computed<IJwtPayload | null>(() => {
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
    const body: Record<string, string> = { email, password };
    if (tenantId) body["tenant_id"] = tenantId;

    this.http
      .post<ITokenResponse>(`${environment.apiUrl}/auth/login`, body)
      .subscribe({
        next: (res) => {
          this.setTokens(res.access_token, res.refresh_token);
          this.router.navigate(["/"]);
        },
        error: () => {
          /* caller handles */
        },
      });
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    this.token.set(null);
    this.router.navigate(["/login"]);
  }

  refreshToken(): void {
    const refresh = localStorage.getItem(REFRESH_KEY);
    if (!refresh) {
      this.logout();
      return;
    }

    this.http
      .post<ITokenResponse>(`${environment.apiUrl}/auth/refresh`, {
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

  private setTokens(accessToken: string, refreshToken?: string): void {
    localStorage.setItem(TOKEN_KEY, accessToken);
    this.token.set(accessToken);
    if (refreshToken) {
      localStorage.setItem(REFRESH_KEY, refreshToken);
    }
  }
}
