import { bootstrapApplication } from "@angular/platform-browser";
import { appConfig } from "./app/app.config";
import { App } from "./app/app";

bootstrapApplication(App, appConfig).catch((err: unknown) => {
  const error =
    err instanceof Error
      ? err
      : new Error(`Bootstrap failed: ${String(err)}`);
  if (typeof globalThis.reportError === "function") {
    globalThis.reportError(error);
  }
  throw error;
});
