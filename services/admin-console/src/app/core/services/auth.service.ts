import { DestroyRef, Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Router } from "@angular/router";
import { BaseAuthService } from "@yoizen/angular-shared";
import { environment } from "../../../environments/environment";

/** Refresh 60 seconds before expiry to avoid edge-case 401s. */
const REFRESH_MARGIN_MS = 60_000;

@Injectable({ providedIn: "root" })
export class AuthService extends BaseAuthService {
  private refreshTimerId: ReturnType<typeof setTimeout> | null = null;

  constructor(http: HttpClient, router: Router, destroyRef: DestroyRef) {
    super(http as never, router as never);
    this.restoreTokenFromStorage();
    this.scheduleRefresh();
    destroyRef.onDestroy(() => this.clearRefreshTimer());
  }

  protected override get apiBaseUrl(): string {
    return environment.apiUrl;
  }

  protected override get tokenStorageKey(): string {
    return "admin-console-token";
  }

  protected override get refreshStorageKey(): string {
    return "admin-console-refresh";
  }

  protected override get loginTenantMode(): "body" | "header" {
    return "body";
  }

  protected override onAfterSetTokens(): void {
    this.scheduleRefresh();
  }

  protected override onBeforeLogout(): void {
    this.clearRefreshTimer();
  }

  private scheduleRefresh(): void {
    this.clearRefreshTimer();

    const payload = this.jwtPayload();
    if (!payload) return;

    const expiresAt = payload.exp * 1000;
    const delay = expiresAt - Date.now() - REFRESH_MARGIN_MS;

    if (delay <= 0) {
      this.refreshToken();
      return;
    }

    this.refreshTimerId = setTimeout(() => {
      this.refreshTimerId = null;
      this.refreshToken();
    }, delay);
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimerId !== null) {
      clearTimeout(this.refreshTimerId);
      this.refreshTimerId = null;
    }
  }
}
