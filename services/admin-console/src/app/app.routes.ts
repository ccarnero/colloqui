import type { Routes } from "@angular/router";
import { authGuard } from "./core/guards/auth.guard";

/**
 * Phase 4 routes — see nav.config.ts for the section model.
 *
 *  - Section landings: /channels, /connections, /ai (AI),
 *    /processes, /settings + the existing /dashboard for Overview.
 *  - Connections sub-pages live under /connections/*.
 *  - Workflow detail mini-app stays at /workflows/:id (Phase 3).
 *  - Old paths redirect to their new homes for back-compat.
 *  - Pages with no backend (auto-reply, rules, webhooks, all the
 *    static security/platform/notifications pages, etc.) are removed.
 */
export const routes: Routes = [
  {
    path: "",
    loadComponent: () =>
      import("./layout/shell/shell.component").then((m) => m.ShellComponent),
    canActivate: [authGuard],
    children: [
      { path: "", redirectTo: "dashboard", pathMatch: "full" },

      // ── Overview ──────────────────────────────────────────────────────
      {
        path: "dashboard",
        loadComponent: () =>
          import("./features/overview/dashboard/dashboard.component").then(
            (m) => m.DashboardComponent
          ),
      },
      {
        path: "analytics",
        loadComponent: () =>
          import("./features/overview/analytics/analytics.component").then(
            (m) => m.AnalyticsComponent
          ),
      },

      // ── Channels ──────────────────────────────────────────────────────
      {
        path: "channels",
        pathMatch: "full",
        loadComponent: () =>
          import("./features/channels/channels-landing.component").then(
            (m) => m.ChannelsLandingComponent
          ),
      },
      {
        path: "channels/:channel",
        loadComponent: () =>
          import("./features/channels/channels.component").then(
            (m) => m.ChannelsComponent
          ),
      },
      {
        path: "channels/:channel/accounts/:accountId",
        loadComponent: () =>
          import("./features/channels/detail/channel-detail.component").then(
            (m) => m.ChannelDetailComponent
          ),
      },

      // ── Connections (Phase 4) ─────────────────────────────────────────
      {
        path: "connections",
        children: [
          {
            path: "",
            pathMatch: "full",
            loadComponent: () =>
              import(
                "./features/connections/connections-landing.component"
              ).then((m) => m.ConnectionsLandingComponent),
          },
          // HTTP — single flat page (internal/external split deferred to v2).
          {
            path: "http",
            loadComponent: () =>
              import(
                "./features/data-integrations/connectors/connectors.component"
              ).then((m) => m.ConnectorsComponent),
          },
          {
            path: "http/:id",
            loadComponent: () =>
              import(
                "./features/data-integrations/connectors/detail/connector-detail.component"
              ).then((m) => m.ConnectorDetailComponent),
          },
          // Back-compat for previously-split paths.
          { path: "internal-http", redirectTo: "http", pathMatch: "full" },
          { path: "external-http", redirectTo: "http", pathMatch: "full" },
          { path: "http/internal", redirectTo: "http", pathMatch: "full" },
          { path: "http/external", redirectTo: "http", pathMatch: "full" },
          {
            path: "mcp",
            loadComponent: () =>
              import("./features/connections/mcp-servers-page.component").then(
                (m) => m.McpServersPageComponent
              ),
          },
          {
            path: "mcp/:id",
            loadComponent: () =>
              import(
                "./features/connections/mcp-detail/mcp-detail.component"
              ).then((m) => m.McpDetailComponent),
          },
          {
            path: "hosted-services",
            loadComponent: () =>
              import(
                "./features/automation/hosted-services/hosted-services.component"
              ).then((m) => m.HostedServicesComponent),
          },
        ],
      },
      // Back-compat redirects
      { path: "connectors", redirectTo: "connections/http", pathMatch: "full" },
      {
        path: "hosted-services",
        redirectTo: "connections/hosted-services",
        pathMatch: "full",
      },
      { path: "data", redirectTo: "connections", pathMatch: "full" },

      // ── AI ─────────────────────────────────────────────────────
      {
        path: "ai",
        children: [
          {
            path: "",
            pathMatch: "full",
            loadComponent: () =>
              import("./features/automation/ai/ai-landing.component").then(
                (m) => m.AiLandingComponent
              ),
          },
          {
            path: "agents",
            loadComponent: () =>
              import("./features/automation/ai/ai-agents-page.component").then(
                (m) => m.AiAgentsPageComponent
              ),
          },
          {
            path: "agents/new",
            data: { subNavCollapsed: true },
            loadComponent: () =>
              import(
                "./features/automation/ai/detail/ai-agent-editor-page.component"
              ).then((m) => m.AiAgentEditorPageComponent),
          },
          {
            path: "agents/:id",
            loadComponent: () =>
              import(
                "./features/automation/ai/detail/ai-agent-detail.component"
              ).then((m) => m.AiAgentDetailComponent),
            children: [
              { path: "", redirectTo: "overview", pathMatch: "full" },
              {
                path: "overview",
                loadComponent: () =>
                  import(
                    "./features/automation/ai/detail/ai-agent-overview.component"
                  ).then((m) => m.AiAgentOverviewComponent),
              },
              {
                path: "configure",
                data: { subNavCollapsed: true },
                loadComponent: () =>
                  import(
                    "./features/automation/ai/detail/ai-agent-editor-page.component"
                  ).then((m) => m.AiAgentEditorPageComponent),
              },
              {
                path: "settings",
                loadComponent: () =>
                  import(
                    "./features/automation/ai/detail/ai-agent-settings.component"
                  ).then((m) => m.AiAgentSettingsComponent),
              },
            ],
          },
          {
            path: "playground",
            loadComponent: () =>
              import("./features/automation/ai/playground.component").then(
                (m) => m.PlaygroundComponent
              ),
          },
          {
            path: "memories",
            loadComponent: () =>
              import("./features/automation/ai/memories.component").then(
                (m) => m.AgentMemoriesComponent
              ),
          },
          {
            path: "skills",
            loadComponent: () =>
              import(
                "./features/automation/ai/skills/skills-page.component"
              ).then((m) => m.SkillsPageComponent),
          },
          {
            path: "system-variables",
            loadComponent: () =>
              import(
                "./features/automation/ai/system-variables/system-variables-page.component"
              ).then((m) => m.SystemVariablesPageComponent),
          },
          {
            path: "knowledge-bases",
            loadComponent: () =>
              import(
                "./features/automation/ai/knowledge-bases/knowledge-bases-page.component"
              ).then((m) => m.KnowledgeBasesPageComponent),
          },
          {
            path: "knowledge-bases/:id",
            loadComponent: () =>
              import(
                "./features/automation/ai/knowledge-bases/knowledge-base-detail.component"
              ).then((m) => m.KnowledgeBaseDetailComponent),
          },
          {
            path: "structured-kb",
            loadComponent: () =>
              import(
                "./features/automation/ai/structured-kb/skb-list-page.component"
              ).then((m) => m.SkbListPageComponent),
          },
          {
            path: "structured-kb/:id",
            loadComponent: () =>
              import(
                "./features/automation/ai/structured-kb/skb-detail.component"
              ).then((m) => m.SkbDetailComponent),
          },
        ],
      },

      // ── Processes (Phase 4 — renamed from Automate) ───────────────────
      {
        path: "processes",
        loadComponent: () =>
          import("./features/processes/processes-landing.component").then(
            (m) => m.ProcessesLandingComponent
          ),
      },
      {
        path: "processes/trace",
        loadComponent: () =>
          import("./features/processes/trace/message-trace.component").then(
            (m) => m.MessageTraceComponent
          ),
      },
      {
        path: "processes/trace/:correlationId",
        loadComponent: () =>
          import("./features/processes/trace/trace-detail.component").then(
            (m) => m.TraceDetailComponent
          ),
      },
      { path: "automate", redirectTo: "processes", pathMatch: "full" },

      // Workflows mini-app stays at /workflows (Phase 3 routes preserved)
      {
        path: "workflows",
        children: [
          {
            path: "",
            loadComponent: () =>
              import(
                "./features/automation/workflows/workflows.component"
              ).then((m) => m.WorkflowsComponent),
          },
          {
            path: "new",
            loadComponent: () =>
              import(
                "./features/automation/workflows/builder/workflow-builder.component"
              ).then((m) => m.WorkflowBuilderComponent),
          },
          { path: ":id/edit", redirectTo: ":id/builder", pathMatch: "full" },
          {
            path: ":id",
            loadComponent: () =>
              import(
                "./features/automation/workflows/detail/workflow-detail.component"
              ).then((m) => m.WorkflowDetailComponent),
            children: [
              { path: "", redirectTo: "overview", pathMatch: "full" },
              {
                path: "overview",
                loadComponent: () =>
                  import(
                    "./features/automation/workflows/detail/workflow-overview.component"
                  ).then((m) => m.WorkflowOverviewComponent),
              },
              {
                path: "builder",
                loadComponent: () =>
                  import(
                    "./features/automation/workflows/builder/workflow-builder.component"
                  ).then((m) => m.WorkflowBuilderComponent),
                data: { subNavCollapsed: true },
              },
              {
                path: "executions",
                loadComponent: () =>
                  import(
                    "./features/automation/workflows/detail/workflow-executions.component"
                  ).then((m) => m.WorkflowExecutionsComponent),
              },
              {
                path: "runs/:runId",
                loadComponent: () =>
                  import(
                    "./features/automation/workflows/detail/workflow-run-detail.component"
                  ).then((m) => m.WorkflowRunDetailComponent),
              },
              {
                path: "settings",
                loadComponent: () =>
                  import(
                    "./features/automation/workflows/detail/workflow-settings.component"
                  ).then((m) => m.WorkflowSettingsComponent),
              },
            ],
          },
        ],
      },

      // ── Schedules ────────────────────────────────────────────────────
      {
        path: "schedules",
        children: [
          {
            path: "",
            loadComponent: () =>
              import(
                "./features/automation/schedules/schedules.component"
              ).then((m) => m.SchedulesComponent),
          },
          {
            path: ":id",
            loadComponent: () =>
              import(
                "./features/automation/schedules/detail/schedule-detail.component"
              ).then((m) => m.ScheduleDetailComponent),
            children: [
              { path: "", redirectTo: "overview", pathMatch: "full" },
              {
                path: "overview",
                loadComponent: () =>
                  import(
                    "./features/automation/schedules/detail/schedule-overview.component"
                  ).then((m) => m.ScheduleOverviewComponent),
              },
              {
                path: "executions",
                loadComponent: () =>
                  import(
                    "./features/automation/schedules/detail/schedule-executions.component"
                  ).then((m) => m.ScheduleExecutionsComponent),
              },
            ],
          },
        ],
      },

      // ── Settings ──────────────────────────────────────────────────────
      {
        path: "settings",
        loadComponent: () =>
          import("./features/settings-hub/settings-hub.component").then(
            (m) => m.SettingsHubComponent
          ),
      },
      {
        path: "users",
        loadComponent: () =>
          import("./features/identity/users/users.component").then(
            (m) => m.UsersComponent
          ),
      },
      {
        path: "roles",
        loadComponent: () =>
          import("./features/identity/roles/roles.component").then(
            (m) => m.RolesComponent
          ),
      },
      {
        path: "api-keys",
        loadComponent: () =>
          import("./features/identity/api-keys/api-keys.component").then(
            (m) => m.ApiKeysComponent
          ),
      },
      {
        path: "billing",
        loadComponent: () =>
          import("./features/tenant-management/billing/billing.component").then(
            (m) => m.BillingComponent
          ),
      },
    ],
  },
  {
    path: "login",
    loadComponent: () =>
      import("./features/auth/login.component").then((m) => m.LoginComponent),
  },
  // Catch-all for deleted/unknown paths.
  { path: "**", redirectTo: "dashboard" },
];
