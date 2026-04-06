import { Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Router } from "@angular/router";
import { BaseAuthService } from "@yoizen/angular-shared";
import { environment } from "../../../environments/environment";

@Injectable({ providedIn: "root" })
export class AuthService extends BaseAuthService {
  constructor(http: HttpClient, router: Router) {
    super(http as never, router as never);
    this.restoreTokenFromStorage();
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
}
