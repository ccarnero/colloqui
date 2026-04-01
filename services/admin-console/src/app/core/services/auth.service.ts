import { Injectable } from "@angular/core";
import { BaseAuthService } from "@yoizen/angular-shared";
import { environment } from "../../../environments/environment";

@Injectable({ providedIn: "root" })
export class AuthService extends BaseAuthService {
  constructor() {
    super();
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
