export interface INavPage {
  label: string;
  route: string;
  dividerBefore?: true;
}

export interface INavSection {
  key: string;
  label: string;
  /** Route prefixes used to detect the active section from the current URL. */
  matchPaths: string[];
  pages: INavPage[];
}

export const NAV_SECTIONS: INavSection[] = [
  {
    key: "overview",
    label: "Overview",
    matchPaths: ["/dashboard", "/analytics"],
    pages: [
      { label: "Dashboard", route: "/dashboard" },
      { label: "Analytics", route: "/analytics" },
    ],
  },
  {
    key: "channels",
    label: "Channels",
    matchPaths: ["/channels", "/auto-reply"],
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
    pages: [
      { label: "Agents", route: "/yoizenclaw/agents" },
      { label: "Playground", route: "/yoizenclaw/playground" },
      { label: "Memories", route: "/yoizenclaw/memories" },
    ],
  },
  {
    key: "automate",
    label: "Automate",
    matchPaths: [
      "/workflows",
      "/rules",
      "/scheduler",
      "/webhooks",
      "/hosted-services",
    ],
    pages: [
      { label: "Workflows", route: "/workflows" },
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
      "/connectors",
      "/integrations",
      "/data-sources",
      "/schema-manager",
      "/data-export",
    ],
    pages: [
      { label: "Connectors", route: "/connectors" },
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
    pages: [
      // Identity
      { label: "Users", route: "/users" },
      { label: "Roles & Permissions", route: "/roles" },
      // Tenant
      { label: "Billing", route: "/billing", dividerBefore: true },
      { label: "Quotas", route: "/quotas" },
      { label: "Customization", route: "/customization" },
      // Security
      { label: "IP Allowlist", route: "/ip-allowlist", dividerBefore: true },
      { label: "Audit Log", route: "/audit-log" },
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
