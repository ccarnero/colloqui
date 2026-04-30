import { type ApplicationConfig } from "@angular/core";

import { provideCoreApp } from "@yoizen/angular-shared";
import { routes } from "./app.routes";
import { AuthService } from "./core/services/auth.service";

export const appConfig: ApplicationConfig = {
  providers: provideCoreApp({ routes, authServiceClass: AuthService }),
};
