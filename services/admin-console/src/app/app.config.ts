import { type ApplicationConfig } from "@angular/core";
import { provideMonacoEditor } from "ngx-monaco-editor-v2";

import { provideCoreApp } from "@yoizen/angular-shared";
import { routes } from "./app.routes";
import { AuthService } from "./core/services/auth.service";

export const appConfig: ApplicationConfig = {
  providers: [
    ...provideCoreApp({ routes, authServiceClass: AuthService }),
    provideMonacoEditor({
      defaultOptions: {
        theme: "vs-dark",
        minimap: { enabled: false },
        formatOnPaste: true,
        wordWrap: "on",
      },
    }),
  ],
};
