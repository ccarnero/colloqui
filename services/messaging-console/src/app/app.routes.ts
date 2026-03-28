import { Routes } from "@angular/router";
import { authGuard } from "./core/guards/auth.guard";

export const routes: Routes = [
  {
    path: "",
    loadComponent: () =>
      import("./layout/shell/shell.component").then(
        (m) => m.ShellComponent,
      ),
    canActivate: [authGuard],
    children: [
      { path: "", redirectTo: "accounts", pathMatch: "full" },
      {
        path: "accounts",
        loadComponent: () =>
          import(
            "./features/accounts/account-list.component"
          ).then((m) => m.AccountListComponent),
      },
      {
        path: "connect",
        loadComponent: () =>
          import(
            "./features/accounts/connect-account.component"
          ).then((m) => m.ConnectAccountComponent),
      },
      {
        path: "accounts/:id/settings",
        loadComponent: () =>
          import(
            "./features/accounts/account-settings.component"
          ).then((m) => m.AccountSettingsComponent),
      },
      {
        path: "messaging",
        loadComponent: () =>
          import(
            "./features/messaging/message-composer.component"
          ).then((m) => m.MessageComposerComponent),
      },
      {
        path: "auto-reply",
        loadComponent: () =>
          import(
            "./features/auto-reply/auto-reply.component"
          ).then((m) => m.AutoReplyComponent),
      },
    ],
  },
  {
    path: "login",
    loadComponent: () =>
      import("./features/auth/login.component").then(
        (m) => m.LoginComponent,
      ),
  },
  { path: "**", redirectTo: "accounts" },
];
