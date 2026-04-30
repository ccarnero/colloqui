import { DestroyRef, Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Router } from "@angular/router";
import type { ITokenResponse } from "@yoizen/angular-shared";
import { BaseAuthService } from "@yoizen/angular-shared";
import { environment } from "../../../environments/environment";

/** Refresh 60 seconds before expiry to avoid edge-case 401s. */
const REFRESH_MARGIN_MS = 60_000;

@Injectable({ providedIn: "root" })
export class AuthService extends BaseAuthService {
  private refreshTimerId: ReturnType<typeof setTimeout> | null = null;

  constructor(http: HttpClient, router: Router, destroyRef: DestroyRef) {
    // Peers resolve duplicate `@angular/common` typings; runtime types match.
    super(http as never, router as never);
    this.restoreTokenFromStorage();
    this.scheduleRefresh();
    destroyRef.onDestroy(() => this.clearRefreshTimer());
  }

  protected override get apiBaseUrl(): string {
    return environment.apiUrl;
  }

  protected override get tokenStorageKey(): string {
    return "messaging-console-token";
  }

  protected override get refreshStorageKey(): string {
    return "messaging-console-refresh";
  }

  protected override get loginTenantMode(): "body" | "header" {
    return "header";
  }

  protected override onAfterSetTokens(): void {
    this.scheduleRefresh();
  }

  protected override onBeforeLogout(): void {
    this.clearRefreshTimer();
  }

  /**
   * Returns an Observable so the caller can handle success/error in the UI.
   */
  loginWithResult(email: string, password: string, tenantId?: string) {
    return this.postLogin(email, password, tenantId);
  }

  handleLoginSuccess(res: ITokenResponse): void {
    this.completeLogin(res);
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
