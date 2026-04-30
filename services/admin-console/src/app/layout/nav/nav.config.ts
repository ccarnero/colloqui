/**
 * Visual treatment for a sub-nav indicator.
 *  - "count":         muted gray number (informational, e.g. "Users 142")
 *  - "count-warn":    amber number (something needs attention soon)
 *  - "count-danger":  red number (something needs you now)
 *  - "dot":           a single colored status dot (no number)
 */
export type NavIndicatorKind =
  | "count"
  | "count-warn"
  | "count-danger"
  | "dot";

/**
 * Declares that a nav item should display a live indicator.
 * `source` is a free-form key resolved at render time by the
 * NavIndicatorRegistry. Phase 2 wires concrete signals; Phase 1 leaves
 * these inert (registry returns null and nothing renders).
 */
export interface INavIndicator {
  kind: NavIndicatorKind;
  source: string;
}

export interface INavPage {
  label: string;
  route: string;
  dividerBefore?: true;
  /** Optional live indicator (count or dot) shown next to the label. */
  indicator?: INavIndicator;
}

export interface INavSection {
  key: string;
  label: string;
  /** Route prefixes used to detect the active section from the current URL. */
  matchPaths: string[];
  /** Path the section tab navigates to (the section's landing page). */
  landingPath: string;
  pages: INavPage[];
}

export const NAV_SECTIONS: INavSection[] = [
  {
    key: "overview",
    label: "Overview",
    matchPaths: ["/dashboard", "/analytics"],
    landingPath: "/dashboard",
    pages: [
      { label: "Dashboard", route: "/dashboard" },
      { label: "Analytics", route: "/analytics" },
    ],
  },
  {
    key: "channels",
    label: "Channels",
    matchPaths: ["/channels", "/auto-reply"],
    landingPath: "/channels",
    pages: [
      { label: "WhatsApp", route: "/channels/whatsapp" },
      { label: "Telegram", route: "/channels/telegram" },
      { label: "Auto-Reply", route: "/auto-reply" },
    ],
  },
  {
    key: "ai",
    label: "AI",
    matchPaths: ["/yoizenclaw"],
    landingPath: "/yoizenclaw",
    pages: [
      { label: "Agents", route: "/yoizenclaw/agents" },
      { label: "Playground", route: "/yoizenclaw/playground" },
      {
        label: "Memories",
        route: "/yoizenclaw/memories",
        indicator: { kind: "count-danger", source: "ai.memories.pending" },
      },
    ],
  },
  {
    key: "automate",
    label: "Automate",
    matchPaths: [
      "/automate",
      "/workflows",
      "/rules",
      "/scheduler",
      "/webhooks",
      "/hosted-services",
    ],
    landingPath: "/automate",
    pages: [
      {
        label: "Workflows",
        route: "/workflows",
        indicator: { kind: "count-danger", source: "automate.workflows.failing" },
      },
      { label: "Rules", route: "/rules" },
      { label: "Scheduler", route: "/scheduler" },
      { label: "Webhooks", route: "/webhooks" },
      { label: "Hosted Services", route: "/hosted-services" },
    ],
  },
  {
    key: "data",
    label: "Data",
    matchPaths: [
      "/data",
      "/connectors",
      "/integrations",
      "/data-sources",
      "/schema-manager",
      "/data-export",
    ],
    landingPath: "/data",
    pages: [
      {
        label: "Connectors",
        route: "/connectors",
        indicator: { kind: "count-danger", source: "data.connectors.errored" },
      },
      { label: "Integrations", route: "/integrations" },
      { label: "Data Sources", route: "/data-sources" },
      { label: "Schema Manager", route: "/schema-manager" },
      { label: "Data Export", route: "/data-export" },
    ],
  },
  {
    key: "settings",
    label: "Settings",
    matchPaths: [
      "/settings",
      "/users",
      "/roles",
      "/billing",
      "/quotas",
      "/customization",
      "/ip-allowlist",
      "/audit-log",
      "/security-center",
      "/compliance",
      "/data-retention",
      "/notification-rules",
      "/email-templates",
      "/feature-flags",
      "/environments",
      "/system-health",
    ],
    landingPath: "/settings",
    pages: [
      // Identity
      { label: "Users", route: "/users" },
      { label: "Roles & Permissions", route: "/roles" },
      // Tenant
      { label: "Billing", route: "/billing", dividerBefore: true },
      {
        label: "Quotas",
        route: "/quotas",
        indicator: { kind: "count-warn", source: "settings.quotas.nearLimit" },
      },
      { label: "Customization", route: "/customization" },
      // Security
      { label: "IP Allowlist", route: "/ip-allowlist", dividerBefore: true },
      {
        label: "Audit Log",
        route: "/audit-log",
        indicator: { kind: "count-danger", source: "settings.audit.alerts" },
      },
      { label: "Security Center", route: "/security-center" },
      { label: "Compliance", route: "/compliance" },
      { label: "Data Retention", route: "/data-retention" },
      // Notifications
      {
        label: "Notification Rules",
        route: "/notification-rules",
        dividerBefore: true,
      },
      { label: "Email Templates", route: "/email-templates" },
      // Platform
      { label: "Feature Flags", route: "/feature-flags", dividerBefore: true },
      { label: "Environments", route: "/environments" },
      { label: "System Health", route: "/system-health" },
    ],
  },
];
