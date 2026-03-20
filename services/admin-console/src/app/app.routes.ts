import { Routes } from "@angular/router";
import { authGuard } from "./core/guards/auth.guard";

export const routes: Routes = [
  {
    path: "",
    loadComponent: () =>
      import("./layout/shell/shell.component").then((m) => m.ShellComponent),
    canActivate: [authGuard],
    children: [
      { path: "", redirectTo: "dashboard", pathMatch: "full" },
      {
        path: "dashboard",
        loadComponent: () =>
          import("./features/overview/dashboard/dashboard.component").then(
            (m) => m.DashboardComponent,
          ),
      },
      {
        path: "analytics",
        loadComponent: () =>
          import("./features/overview/analytics/analytics.component").then(
            (m) => m.AnalyticsComponent,
          ),
      },
      {
        path: "users",
        loadComponent: () =>
          import("./features/identity/users/users.component").then(
            (m) => m.UsersComponent,
          ),
      },
      {
        path: "roles",
        loadComponent: () =>
          import("./features/identity/roles/roles.component").then(
            (m) => m.RolesComponent,
          ),
      },
      {
        path: "groups",
        loadComponent: () =>
          import("./features/identity/groups/groups.component").then(
            (m) => m.GroupsComponent,
          ),
      },
      {
        path: "sso",
        loadComponent: () =>
          import("./features/identity/sso/sso.component").then(
            (m) => m.SsoComponent,
          ),
      },
      {
        path: "mfa",
        loadComponent: () =>
          import("./features/identity/mfa/mfa.component").then(
            (m) => m.MfaComponent,
          ),
      },
      {
        path: "api-keys",
        loadComponent: () =>
          import("./features/identity/api-keys/api-keys.component").then(
            (m) => m.ApiKeysComponent,
          ),
      },
      {
        path: "billing",
        loadComponent: () =>
          import(
            "./features/tenant-management/billing/billing.component"
          ).then((m) => m.BillingComponent),
      },
      {
        path: "quotas",
        loadComponent: () =>
          import("./features/tenant-management/quotas/quotas.component").then(
            (m) => m.QuotasComponent,
          ),
      },
      {
        path: "customization",
        loadComponent: () =>
          import(
            "./features/tenant-management/customization/customization.component"
          ).then((m) => m.CustomizationComponent),
      },
      {
        path: "workflows",
        loadComponent: () =>
          import(
            "./features/automation/workflows/workflows.component"
          ).then((m) => m.WorkflowsComponent),
      },
      {
        path: "webhooks",
        loadComponent: () =>
          import("./features/automation/webhooks/webhooks.component").then(
            (m) => m.WebhooksComponent,
          ),
      },
      {
        path: "scheduler",
        loadComponent: () =>
          import(
            "./features/automation/scheduler/scheduler.component"
          ).then((m) => m.SchedulerComponent),
      },
      {
        path: "rules",
        loadComponent: () =>
          import("./features/automation/rules/rules.component").then(
            (m) => m.RulesComponent,
          ),
      },
      {
        path: "data-sources",
        loadComponent: () =>
          import(
            "./features/data-integrations/data-sources/data-sources.component"
          ).then((m) => m.DataSourcesComponent),
      },
      {
        path: "integrations",
        loadComponent: () =>
          import(
            "./features/data-integrations/integrations/integrations.component"
          ).then((m) => m.IntegrationsComponent),
      },
      {
        path: "internal-sources",
        loadComponent: () =>
          import(
            "./features/data-integrations/network-sources/internal-sources/internal-sources.component"
          ).then((m) => m.InternalSourcesComponent),
      },
      {
        path: "external-sources",
        loadComponent: () =>
          import(
            "./features/data-integrations/network-sources/external-sources/external-sources.component"
          ).then((m) => m.ExternalSourcesComponent),
      },
      {
        path: "data-export",
        loadComponent: () =>
          import(
            "./features/data-integrations/data-export/data-export.component"
          ).then((m) => m.DataExportComponent),
      },
      {
        path: "schema-manager",
        loadComponent: () =>
          import(
            "./features/data-integrations/schema-manager/schema-manager.component"
          ).then((m) => m.SchemaManagerComponent),
      },
      {
        path: "audit-log",
        loadComponent: () =>
          import(
            "./features/security/audit-log/audit-log.component"
          ).then((m) => m.AuditLogComponent),
      },
      {
        path: "security-center",
        loadComponent: () =>
          import(
            "./features/security/security-center/security-center.component"
          ).then((m) => m.SecurityCenterComponent),
      },
      {
        path: "compliance",
        loadComponent: () =>
          import(
            "./features/security/compliance/compliance.component"
          ).then((m) => m.ComplianceComponent),
      },
      {
        path: "ip-allowlist",
        loadComponent: () =>
          import(
            "./features/security/ip-allowlist/ip-allowlist.component"
          ).then((m) => m.IpAllowlistComponent),
      },
      {
        path: "data-retention",
        loadComponent: () =>
          import(
            "./features/security/data-retention/data-retention.component"
          ).then((m) => m.DataRetentionComponent),
      },
      {
        path: "notification-rules",
        loadComponent: () =>
          import(
            "./features/notifications/notification-rules/notification-rules.component"
          ).then((m) => m.NotificationRulesComponent),
      },
      {
        path: "email-templates",
        loadComponent: () =>
          import(
            "./features/notifications/email-templates/email-templates.component"
          ).then((m) => m.EmailTemplatesComponent),
      },
      {
        path: "feature-flags",
        loadComponent: () =>
          import(
            "./features/platform/feature-flags/feature-flags.component"
          ).then((m) => m.FeatureFlagsComponent),
      },
      {
        path: "environments",
        loadComponent: () =>
          import(
            "./features/platform/environments/environments.component"
          ).then((m) => m.EnvironmentsComponent),
      },
      {
        path: "system-health",
        loadComponent: () =>
          import(
            "./features/platform/system-health/system-health.component"
          ).then((m) => m.SystemHealthComponent),
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
  { path: "**", redirectTo: "dashboard" },
];
